// @ts-nocheck
import logger from '../../_utils/logger.js';
import { requireProAuth } from '../../_utils/auth.js';
import { createGeminiBreaker } from '../../lib/gemini-circuit-breaker.js';
import { db } from '../../../src/db/index.js';
import { ReviewQueueItem } from '../../../src/db/schema.js';
import { recordMetric } from '../../lib/gemini-metrics.js';

/**
 * Agent Discovery API (Pro-only)
 *
 * POST /api/pro/agent-discovery
 * Body: { category: "Logement" | "Santé" | ..., submit?: boolean }
 *
 * Uses Gemini 2.0 Flash with Google Search grounding to find
 * new social aid updates for a given category.
 * Returns structured findings for human validation.
 *
 * When `submit: true`, findings are written into ReviewQueueItem
 * for admin validation before publication.
 */

const AGENT_TIMEOUT_MS = 30_000;

import { getGenAI } from '../../lib/gemini.js';

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    // PKG-11 audit: a disabled or moved account keeps a « revoked » context that belongs to no organization; this route acts on the user alone, so it refuses it
    if (req.user?.role === 'revoked') return res.status(404).json({ error: 'Not found' });
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    // Feature flag — agents can be disabled without redeployment
    if (process.env.ENABLE_AI_AGENT !== 'true') {
        return res.status(503).json({ error: 'AI agents are disabled', flag: 'ENABLE_AI_AGENT' });
    }

    const { category, submit } = req.body || {};
    if (!category) {
        return res.status(400).json({ error: 'Catégorie requise.' });
    }

    // Sanitize category input against prompt injection
    const safeCategory = String(category).replace(/<[^>]*>/g, '').slice(0, 100);

    const prompt = `Trouve les 5 dernières nouveautés ou changements concernant les aides sociales en France pour la catégorie "${safeCategory}". Pour chaque aide, donne : titre, source officielle, résumé court des critères d'éligibilité. Réponds en JSON : un tableau d'objets avec les clés "title", "source", "summary".`;

    try {
        const { AIProviderPolicy, PROVIDER, AUDIENCE } = await import('../../lib/ai-policy.js');
        const policyDecision = AIProviderPolicy.evaluate({
            provider: PROVIDER.GEMINI,
            audience: AUDIENCE.PROFESSIONAL
        });
        if (!policyDecision.allowed) {
            return res.status(403).json({ error: 'IA_BLOCKED_PENDING_REVIEW' });
        }

        const ai = await getGenAI();
        const model = ai.getGenerativeModel({
            model: 'gemini-2.0-flash',
            systemInstruction: {
                parts: [
                    {
                        text: 'Tu es l\'Agent Chercheur de AccesDirectAide, une plateforme solidaire. Fournis des informations sociales vérifiées et sourcées.',
                    },
                ],
            },
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1024,
            },
        });

        const breaker = createGeminiBreaker((/** @type {import("../../lib/gemini-types.js").GeminiPrompt} */ p) => model.generateContent(p));
        const startTime = Date.now();
        const result = await breaker.fire(prompt);

        // Check for circuit breaker fallback
        if (result && result.fallback) {
            recordMetric({ type: 'discovery', model: 'gemini-2.0-flash', latencyMs: Date.now() - startTime, success: false, circuitBreakerOpen: true });
            return res.status(200).json({ discoveries: [], fallback: true, message: result.message });
        }

        const response = await result.response;
        const raw = response.text() || '[]';

        // Record metrics
        recordMetric({
            type: 'discovery',
            model: 'gemini-2.0-flash',
            promptTokens: response.usageMetadata?.promptTokenCount || 0,
            completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata?.totalTokenCount || 0,
            latencyMs: Date.now() - startTime,
            success: true,
        });

        // Parse JSON from AI response (strip markdown fences if present)
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        let findings = [];
        try {
            findings = JSON.parse(cleaned);
        } catch {
            findings = [{ title: 'Résultat brut', source: 'Gemini', summary: cleaned }];
        }

        // If submit flag is set, create ReviewQueueItems for admin validation
        let submitted = 0;
        if (submit && Array.isArray(findings) && findings.length > 0) {
            for (const item of findings) {
                try {
                    const entityId = `discovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    await db.insert(ReviewQueueItem).values({
                            entityType: 'AIDE',
                            entityId,
                            title: String(item.title || 'Sans titre').slice(0, 255),
                            reason: 'AI_DISCOVERY',
                            severity: 'LOW',
                            status: 'open',
                            details: {
                                source: item.source || 'Gemini Search',
                                summary: item.summary || '',
                                category,
                                aiGenerated: true,
                                discoveredBy: req.user?.userId || 'system',
                                discoveredAt: new Date().toISOString(),
                            },
                    });
                    submitted++;
                } catch (dbErr) {
                    logger.warn({ err: dbErr }, '[Discovery] ReviewQueueItem creation failed');
                }
            }
        }

        return res.status(200).json({
            ok: true,
            category,
            findings,
            count: findings.length,
            submitted,
            scannedAt: new Date().toISOString(),
        });
    } catch (error) {
        logger.error({ err: error }, '[Discovery] Erreur');
        const isTimeout = error?.message?.includes('timeout');
        return res.status(isTimeout ? 504 : 500).json({
            error: isTimeout ? 'Le scan a expiré (30s). Réessayez.' : 'Échec du scan autonome.',
        });
    }
}

export default requireProAuth(handler);
