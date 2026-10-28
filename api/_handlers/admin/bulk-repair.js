// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ReviewQueueItem } from '../../../src/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { generateText } from '../../lib/gemini.js';
import { UNAVAILABLE, humanOnly, suggestionsAllowed } from '../../_services/repair-suggestions.js';
const MAX_BATCH_SIZE = 25;

/**
 * bulk-repair.js
 * Batch AI repair endpoint.
 * Processes open ReviewQueueItems sequentially (respects Gemini rate limits).
 * Stores AI suggestions in details — never modifies entities directly.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    // the same switch as the single-item agent (it was missing here)
    if (process.env.ENABLE_AI_AGENT !== 'true') {
        return res.status(503).json({ error: 'AI agents are disabled', flag: 'ENABLE_AI_AGENT', message: 'Les agents d’IA sont désactivés sur cette installation.' });
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

    // owner LAB audit: no ungrounded suggestion while the AI policy blocks the provider (see api/_services/repair-suggestions.js)
    if (!suggestionsAllowed()) return res.status(UNAVAILABLE.status).json(UNAVAILABLE.body);
    const { severity = 'P0', limit = 10 } = req.body || {};
    const safeLimit = Math.min(Math.max(1, Number(limit) || 10), MAX_BATCH_SIZE);

    try {
        // 1. Fetch open items matching the requested severity
        const itemsToRepair = await db.query.ReviewQueueItem.findMany({
            where: and(eq(ReviewQueueItem.severity, String(severity)), inArray(ReviewQueueItem.status, ['open', 'OPEN'])),   // writers use both spellings
            orderBy: (ri, { asc }) => [asc(ri.createdAt)],
            limit: safeLimit,
        });

        if (itemsToRepair.length === 0) {
            return res.status(200).json({
                success: true,
                message: `No open ${severity} items to repair.`,
                count: 0,
                results: [],
            });
        }

        /** @type {Array<{ id: string, title: string|null, status: 'repaired' | 'failed' | 'skipped', error?: string }>} */
        const results = [];
        let successCount = 0;

        // 2. Sequential processing (avoids Gemini rate-limit 429s)
        for (const item of itemsToRepair) {
            logger.info({ id: item.id, title: item.title }, 'bulk_repair.processing');

            let prompt = '';

            if (item.reason.includes('documents_necessaires')) {
                prompt = `Tu es un expert du droit social français.
L'aide sociale "${item.title}" n'a pas de liste de documents nécessaires.
En utilisant tes connaissances et les sources officielles (service-public.fr, sites ministériels),
fournis la liste exacte des pièces justificatives à fournir pour une demande de cette aide.
Réponds EXCLUSIVEMENT au format JSON valide : { "documents": ["Document 1", "Document 2", ...] }
Ne mets aucun texte avant ou après le JSON.`;
            } else if (item.reason === 'MISSING_SOURCE_DOCUMENT') {
                prompt = `Trouve l'URL officielle (service-public.fr, .gouv.fr, ou site ministériel)
qui décrit "${item.title}" (type: ${item.entityType}).
Réponds EXCLUSIVEMENT au format JSON valide : { "url": "https://..." }
Ne mets aucun texte avant ou après le JSON.`;
            } else if (humanOnly(item.reason)) {
                results.push({ id: item.id, title: item.title, status: 'skipped', error: 'HUMAN_DECISION' });   // a human verification, never a model's
                continue;
            } else {
                results.push({ id: item.id, title: item.title, status: 'skipped' });
                continue;
            }

            try {
                const responseText = await generateText(prompt, { useSearch: true, metricType: 'hive-scan' });
                const cleanJson = responseText.replace(/```json|```/g, '').trim();
                const suggestion = JSON.parse(cleanJson);

                await db.update(ReviewQueueItem).set({
                        details: {
                            ...(typeof item.details === 'object' && item.details !== null
                                ? item.details
                                : {}),
                            ai_fix: suggestion,
                            ai_suggestion_status: 'PENDING_HUMAN_REVIEW',   // PKG-6 / D22: the item stays open until a named administrator decides
                            ai_suggested_at: new Date().toISOString(),
                        },
                }).where(eq(ReviewQueueItem.id, item.id));

                successCount++;
                results.push({ id: item.id, title: item.title, status: 'repaired' });
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'unknown';
                logger.error({ id: item.id, error: errorMsg }, 'bulk_repair.item_error');
                results.push({ id: item.id, title: item.title, status: 'failed', error: errorMsg });
            }
        }

        logger.info(
            { severity, total: itemsToRepair.length, success: successCount },
            'bulk_repair.complete',
        );

        return res.status(200).json({
            success: true,
            count: successCount,
            total: itemsToRepair.length,
            results,
        });
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : 'unknown' },
            'bulk_repair.error',
        );
        return res.status(500).json({ error: 'Bulk repair process failed' });
    }
}
