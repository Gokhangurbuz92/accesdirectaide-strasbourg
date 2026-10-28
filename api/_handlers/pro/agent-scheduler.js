import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ReviewQueueItem, AuditLog } from '../../../src/db/schema.js';
import { requireProAuth } from '../../_utils/auth.js';
import { discoverByCategory } from '../../lib/ai-discovery-core.js';

/**
 * Agent Scheduler API (Pro-only)
 *
 * POST /api/pro/agent-scheduler
 * Body: { poleId, categoryId }
 *
 * Delegates discovery to the shared ai-discovery-core module,
 * then writes findings to ReviewQueueItem + AuditLog.
 * All findings require human validation (no auto-validation).
 */

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

    const { poleId, categoryId } = req.body || {};
    if (!poleId) {
        return res.status(400).json({ error: 'poleId requis.' });
    }

    const category = String(categoryId || 'toutes catégories').replace(/<[^>]*>/g, '').slice(0, 100);

    try {
        // 1. Delegate to shared discovery core (no duplication)
        const { findings: discoveries, fallback } = await discoverByCategory(category, {
            metricType: 'scheduler',
            limit: 5,
        }).catch(err => {
            logger.warn({ err }, '[Scheduler] Discovery call failed, continuing with empty results');
            return { findings: [], fallback: true };
        });

        // 2. ALL discoveries go to review queue (NO auto-validation)
        // Previously auto-validated at confidence > 95 — removed for safety.
        // A human must always review AI-generated content.
        let submitted = 0;
        for (const item of discoveries) {
            try {
                const entityId = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                await db.insert(ReviewQueueItem).values({
                        entityType: 'AIDE',
                        entityId,
                        title: String(item.title || 'Sans titre').slice(0, 255),
                        reason: 'AI_SCHEDULED_DISCOVERY',
                        severity: 'LOW',
                        status: 'OPEN',
                        details: {
                            source: item.source || 'Gemini Search',
                            summary: item.summary || '',
                            category,
                            confidence: item.confidence || 0,
                            scheduledBy: req.user?.userId || 'system',
                        },
                });
                submitted++;
            } catch {
                // Skip individual failures
            }
        }

        logger.info({ poleId, category, discovered: discoveries.length, submitted }, '[Scheduler] All results queued for human review');

        // 3. Audit trail
        await db.insert(AuditLog).values({
                action: 'AI_HIVE_ENRICHMENT_CYCLE',
                entity_id: String(poleId).slice(0, 255),
                entity: 'CONTENT_FACTORY',
                details: {
                    category,
                    discovered: discoveries.length,
                    autoValidated: 0,  // No more auto-validation
                    pendingReview: discoveries.length,
                    submitted,
                    aiPowered: !fallback,
                },
                ip_hash: 'AI_ORCHESTRATOR',
        });

        return res.status(200).json({
            ok: true,
            poleId,
            categoryId: category,
            discovered: discoveries.length,
            autoValidated: 0,
            pendingReview: discoveries.length,
            submitted,
            nextSchedule: 'Prochain cycle automatique',
        });
    } catch (error) {
        logger.error({ err: error }, '[Scheduler] Erreur');
        return res.status(500).json({ error: "Échec de l'orchestration." });
    }
}

export default requireProAuth(handler);

