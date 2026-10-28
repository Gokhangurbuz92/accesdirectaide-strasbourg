// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ReviewQueueItem } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { generateText } from '../../lib/gemini.js';
import { recordMetric } from '../../lib/gemini-metrics.js';
import { HUMAN_ONLY, UNAVAILABLE, humanOnly, suggestionsAllowed } from '../../_services/repair-suggestions.js';
/**
 * hive-repair.js
 * AI-powered single-item repair agent.
 * Takes a ReviewQueueItem and uses Gemini to generate a fix suggestion.
 * The suggestion is stored in details.ai_suggestion — never modifies the entity directly.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    // Feature flag — agents can be disabled without redeployment
    if (process.env.ENABLE_AI_AGENT !== 'true') {
        return res.status(503).json({ error: 'AI agents are disabled', flag: 'ENABLE_AI_AGENT' });
    }

    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }
    // PKG-6 / D22: asking the AI for a suggestion is an administrator write: a named session with MFA (the retired shared token is refused here)
    if (!(await adminGate(req, res, { write: true }))) return;

    const { itemId } = req.body || {};

    if (!itemId || typeof itemId !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid itemId' });
    }

    try {
        // 1. Retrieve the review queue item
        const reviewItem = await db.query.ReviewQueueItem.findFirst({
            where: eq(ReviewQueueItem.id, itemId),
        });

        if (!reviewItem) {
            return res.status(404).json({ error: 'Review queue item not found' });
        }

        if (String(reviewItem.status).toLowerCase() !== 'open') {   // writers use 'open' and 'OPEN'
            return res.status(400).json({ error: 'Item is not in open status' });
        }
        // owner LAB audit: never a model's opinion on whether a record is still in force; never an ungrounded answer while the AI policy blocks the provider
        if (humanOnly(reviewItem.reason)) return res.status(HUMAN_ONLY.status).json(HUMAN_ONLY.body);
        if (!suggestionsAllowed()) return res.status(UNAVAILABLE.status).json(UNAVAILABLE.body);

        // 2. Build prompt based on the reason
        let prompt = '';

        if (reviewItem.reason.includes('MISSING_REQUIRED_FIELD:documents_necessaires')) {
            prompt = `Tu es un expert du droit social français.
L'aide sociale "${reviewItem.title}" n'a pas de liste de documents nécessaires.
En utilisant tes connaissances et les sources officielles (service-public.fr, sites ministériels),
fournis la liste exacte des pièces justificatives à fournir pour une demande de cette aide.
Réponds EXCLUSIVEMENT au format JSON valide : { "documents": ["Document 1", "Document 2", ...] }
Ne mets aucun texte avant ou après le JSON.`;
        } else if (reviewItem.reason === 'MISSING_SOURCE_DOCUMENT') {
            prompt = `Trouve l'URL officielle (service-public.fr, .gouv.fr, ou site ministériel)
qui décrit l'entité "${reviewItem.title}" (type: ${reviewItem.entityType}).
Réponds EXCLUSIVEMENT au format JSON valide : { "url": "https://..." }
Ne mets aucun texte avant ou après le JSON.`;
        }

        if (!prompt) {
            return res.status(400).json({
                error: `Reason "${reviewItem.reason}" is not handled by the repair agent.`,
            });
        }

        // 3. Call Gemini
        const startTime = Date.now();
        const responseText = await generateText(prompt, { useSearch: true, metricType: 'hive-repair' });
        const cleanJson = responseText.replace(/```json|```/g, '').trim();

        let suggestion;
        try {
            suggestion = JSON.parse(cleanJson);
        } catch {
            logger.warn(
                { itemId, rawResponse: cleanJson.slice(0, 500) },
                'hive_repair.json_parse_failed',
            );
            return res.status(422).json({
                error: 'AI returned invalid JSON',
                raw: cleanJson.slice(0, 500),
            });
        }

        // 4. Store suggestion in the review queue item (never touch the entity directly).
        //    PKG-6 / D22: the AI never closes the item itself; it stays open until a named administrator decides (review-queue PATCH, audited).
        const [updatedItem] = await db.update(ReviewQueueItem).set({
                details: {
                    ...(typeof reviewItem.details === 'object' && reviewItem.details !== null
                        ? reviewItem.details
                        : {}),
                    ai_suggestion: suggestion,
                    ai_suggestion_status: 'PENDING_HUMAN_REVIEW',
                    ai_suggested_at: new Date().toISOString(),
                },
        }).where(eq(ReviewQueueItem.id, itemId)).returning();

        recordMetric({ type: 'hive-repair', success: true, latencyMs: Date.now() - startTime });
        logger.info({ itemId, title: reviewItem.title }, 'hive_repair.success');

        return res.status(200).json({
            success: true,
            item: updatedItem,
            suggestion,
        });
    } catch (error) {
        logger.error(
            {
                itemId,
                error: error instanceof Error ? error.message : 'unknown',
            },
            'hive_repair.error',
        );
        return res.status(500).json({ error: 'AI repair failed' });
    }
}
