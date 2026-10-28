// @ts-nocheck
import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { AuditLog, ProUser } from '../../../src/db/schema.js';
import { eq, and, sql, inArray, count } from 'drizzle-orm';
import { AUTH_ROLE, requireProRole, requireProStructureContext } from '../../_utils/auth.js';

/**
 * Audit Log API
 *
 * GET /api/pro/audit
 *   ?page=1&limit=50&action=DOSSIER_VIEWED
 *
 * Returns paginated audit log entries for the structure.
 * Only accessible by STRUCTURE_ADMIN and SUPERADMIN.
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { structureId } = proCtx;

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const actionFilter = url.searchParams.get('action');

    try {
        let whereConditions = [sql`${AuditLog.details}->>'structureId' = ${structureId}`];
        if (actionFilter) {
            whereConditions.push(eq(AuditLog.action, actionFilter));
        }

        const [logs, totalCountRes] = await Promise.all([
            db.query.AuditLog.findMany({
                where: and(...whereConditions),
                orderBy: (al, { desc }) => [desc(al.timestamp)],
                offset: (page - 1) * limit,
                limit: limit,
            }),
            db.select({ count: count() }).from(AuditLog).where(and(...whereConditions)),
        ]);
        const totalCount = totalCountRes[0].count;

        const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))];
        const actors = actorIds.length > 0
            ? await db.query.ProUser.findMany({
                where: inArray(ProUser.id, actorIds),
                columns: { id: true, email: true },
            })
            : [];

        const actorMap = {};
        actors.forEach((a) => { actorMap[a.id] = a.email; });

        const entries = logs.map((log) => ({
            id: log.id,
            action: log.action,
            actorId: log.actor_id,
            // @ts-ignore
            actorEmail: actorMap[log.actor_id] || null,
            details: typeof log.details === 'string' ? JSON.parse(log.details) : log.details,
            timestamp: log.timestamp,
            ipHash: log.ip_hash,
        }));

        return res.status(200).json({
            ok: true,
            entries,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
            },
        });
    } catch (error) {
        // @ts-ignore
        logger.error('[Audit Log] Erreur:', error.message);
        return res.status(500).json({ error: 'Impossible de charger le journal.' });
    }
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
