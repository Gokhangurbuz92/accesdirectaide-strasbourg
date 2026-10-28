// @ts-nocheck
import logger from '../../_utils/logger.js';
import crypto, { randomUUID } from 'crypto';
import { getCronAuth, getHeader, scheduledByVercel } from '../../_utils/cronAuth.js';
import { env } from '../../_utils/env.js';
import { createGeminiBreaker } from '../../lib/gemini-circuit-breaker.js';
import { db } from '../../../src/db/index.js';
import { ReviewQueueItem, CronRun } from '../../../src/db/schema.js';
import { recordMetric } from '../../lib/gemini-metrics.js';
import { withLock } from '../../_utils/pipelineLock.js';

/**
 * Hive Scan — Automated AI discovery cron
 *
 * Scans each category via Gemini 2.0 Flash + Google Search grounding
 * and creates ReviewQueueItems for human validation.
 *
 * Endpoint: GET/POST /api/cron/hive-scan
 * Auth: CRON_SECRET (header, bearer, or query param)
 *
 */

const AGENT_TIMEOUT_MS = 30_000;

import { getGenAI } from '../../lib/gemini.js';

const CATEGORIES = [
    'EMPLOI', 'LOGEMENT', 'SANTE', 'FAMILLE',
    'HANDICAP', 'ETUDES', 'MOBILITE', 'ENERGIE',
    'ALIMENTATION', 'NUMERIQUE', 'JUSTICE', 'SENIORS',
];

/**
 * @param {string} category
 * @returns {Promise<Array<{title: string, source: string, summary: string}>>}
 */
async function scanCategory(category) {
    const { AIProviderPolicy, PROVIDER, AUDIENCE } = await import('../../lib/ai-policy.js');
    const policyDecision = AIProviderPolicy.evaluate({
        provider: PROVIDER.GEMINI,
        audience: AUDIENCE.PROFESSIONAL
    });
    if (!policyDecision.allowed) {
        throw new Error('AI_PROVIDER_NOT_ALLOWED');
    }

    const prompt = `En tant qu'Agent Chercheur de AccesDirectAide (plateforme solidaire), trouve les 3 dernières nouveautés ou changements concernant les aides sociales en France pour la catégorie "${category}". Pour chaque aide, donne : titre, source officielle, résumé court des critères d'éligibilité. Réponds en JSON : un tableau d'objets avec les clés "title", "source", "summary".`;

    const ai = await getGenAI();
    const model = ai.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: {
            parts: [
                {
                    text: 'Tu es un agent de veille sociale automatisé. Fournis des informations vérifiées et sourcées. Réponds UNIQUEMENT en JSON valide.',
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
        recordMetric({ type: 'hive-scan', model: 'gemini-2.0-flash', latencyMs: Date.now() - startTime, success: false, circuitBreakerOpen: true });
        return [];
    }

    const response = await result.response;
    const raw = response.text() || '[]';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    recordMetric({
        type: 'hive-scan',
        model: 'gemini-2.0-flash',
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
        latencyMs: Date.now() - startTime,
        success: true,
    });

    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}


/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();

    res.setHeader('x-request-id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed', requestId });
    }

    const auth = getCronAuth(req);
    const vercelCronOk = auth.ok && scheduledByVercel(req);   // trigger label only (item 36)

    if (!auth.ok && auth.reason === 'missing_secret') {
        return res.status(500).json({ error: 'CRON_SECRET is not configured', requestId });
    }

    if (!auth.ok) {
        return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    // Feature flag — agents can be disabled without redeployment. Launch-readiness item 53: a disabled feature is not an outage — it answered 503 on every
    // scheduled run (the monitoring saw a failure each time). The job is no longer scheduled (vercel.json): it uses a cloud AI provider that is not approved
    // (DPIA / DPA), and the automatic veille (D-5 v2) does the source monitoring.
    if (process.env.ENABLE_AI_AGENT !== 'true') {
        return res.status(200).json({ ok: true, skipped: 'disabled', flag: 'ENABLE_AI_AGENT', requestId });
    }

    const startedAt = new Date();
    let totalFound = 0;
    const perCategory = {};

    try {
        const scanResult = await withLock('hive-scan', async () => {
            for (const category of CATEGORIES) {
                logger.info({ requestId, category }, 'cron.hive_scan.scanning');

                try {
                    const findings = await scanCategory(category);
                    let created = 0;

                    for (const item of findings) {
                        try {
                            const entityType = 'AIDE';
                            const reason = 'CRON_HIVE_SCAN';
                            const entityId = crypto.createHash('sha256')
                                .update(`${entityType}:${String(item.title || '')}:${reason}`)
                                .digest('hex')
                                .slice(0, 32);
                            await db.insert(ReviewQueueItem).values({
                                entityType,
                                entityId,
                                title: String(item.title || 'Sans titre').slice(0, 255),
                                reason,
                                severity: 'LOW',
                                status: 'OPEN',
                                details: {
                                    source: item.source || 'Google Search',
                                    summary: item.summary || '',
                                    category,
                                    aiGenerated: true,
                                    discoveredAt: new Date().toISOString(),
                                },
                            });
                            created++;
                        } catch (dbErr) {
                            // Unique constraint violation = duplicate, skip silently
                            // PostgreSQL native code 23505 (unique constraint violation)
                            const pgCode = dbErr?.cause?.code || dbErr?.code;
                            if (pgCode !== '23505') {
                                logger.error({ requestId, category, error: dbErr.message }, 'cron.hive_scan.db_error');
                            }
                        }
                    }

                    // @ts-ignore
                    perCategory[category] = { scanned: findings.length, created };
                    totalFound += created;
                } catch (catErr) {
                    // @ts-ignore
                    logger.error({ requestId, category, error: catErr.message }, 'cron.hive_scan.category_error');
                    // @ts-ignore
                    perCategory[category] = { scanned: 0, created: 0, error: catErr.message };
                }
            }

            const finishedAt = new Date();
            const durationMs = finishedAt.getTime() - startedAt.getTime();

            await db.insert(CronRun).values({
                job: 'HIVE_SCAN',
                status: 'success',
                trigger: vercelCronOk ? 'vercel' : 'manual',
                startedAt,
                finishedAt,
                durationMs,
                requestId,
                vercelEnv: env.runtime.vercelEnv || null,
                metrics: { totalFound, perCategory },
            });

            return {
                ok: true,
                requestId,
                totalFound,
                perCategory,
                durationMs,
            };
        }, { ttl: 900 });

        return res.status(200).json(scanResult);
    } catch (error) {
        // @ts-ignore
        if (error.message?.includes('already running')) {
            logger.warn({ requestId }, 'cron.hive_scan.already_running');
            return res.status(409).json({ ok: false, requestId, error: 'Hive scan already running' });
        }

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        // @ts-ignore
        logger.error({ requestId, error: error.message }, 'cron.hive_scan.fatal');

        try {
            await db.insert(CronRun).values({
                job: 'HIVE_SCAN',
                status: 'failed',
                trigger: vercelCronOk ? 'vercel' : 'manual',
                startedAt,
                finishedAt,
                durationMs,
                requestId,
                vercelEnv: env.runtime.vercelEnv || null,
                // @ts-ignore
                errorSample: String(error.message).slice(0, 500),
            });
        } catch {
            // If even the error logging fails, we still return gracefully
        }

        return res.status(500).json({
            ok: false,
            requestId,
            error: 'Hive scan failed',
        });
    }
}
