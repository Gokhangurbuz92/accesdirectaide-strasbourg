// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Aide, Structure, ReviewQueueItem, SharedDiagnostic, ProUser } from '../../../src/db/schema.js';
import { and, count, desc, eq } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';

/**
 * GET /api/admin/national-stats
 *
 * Aggregates platform-wide metrics for national supervision:
 * - Aids by territorial scope (NATIONAL, REGIONAL, DEPARTMENTAL, COMMUNAL)
 * - Active structures count
 * - Review queue status (Hive AI moderation pipeline)
 * - Social impact (shared diagnostics)
 * - Active pro agents
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    try {
        const [
            aidsByScope,
            structuresActive,
            reviewStats,
            diagnosticsCount,
            activeAgents,
            totalAides,
        ] = await Promise.all([
            // Aids grouped by territorial scope
            db.select({
                territory_scope: Aide.territory_scope,
                _count: { id: count(Aide.id) }
            }).from(Aide)
              .groupBy(Aide.territory_scope)
              .orderBy(desc(count(Aide.id))),

            // Active structures — R7: the publication state (statut) of a verified record; « status » defaults to 'actif' on every row, drafts included
            db.select({ value: count() }).from(Structure).where(and(eq(Structure.statut, 'actif'), eq(Structure.verification_status, 'VERIFIED'))).then(res => res[0].value),

            // Review queue breakdown by status (pending, approved, rejected)
            db.select({
                status: ReviewQueueItem.status,
                _count: { id: count(ReviewQueueItem.id) }
            }).from(ReviewQueueItem)
              .groupBy(ReviewQueueItem.status),

            // Social impact: total shared diagnostics
            db.select({ value: count() }).from(SharedDiagnostic).then(res => res[0].value),

            // Active pro users
            db.select({ value: count() }).from(ProUser).where(eq(ProUser.status, 'active')).then(res => res[0].value),

            // Total aids
            db.select({ value: count() }).from(Aide).then(res => res[0].value),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                summary: {
                    totalAids: totalAides,
                    activeStructures: structuresActive,
                    sharedDiagnostics: diagnosticsCount,
                    activeAgents,
                },
                territorial: aidsByScope.map((row) => ({
                    scope: row.territory_scope || 'UNKNOWN',
                    count: row._count.id,
                })),
                hive: reviewStats.map((row) => ({
                    status: row.status,
                    count: row._count.id,
                })),
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        logger.error('[National Stats Error]:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Échec de la récupération des statistiques nationales',
        });
    }
}
