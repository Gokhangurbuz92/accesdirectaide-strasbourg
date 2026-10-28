import logger from '../../../_utils/logger.js';
import { db } from '../../../../src/db/index.js';
import { ProAuditLog } from '../../../../src/db/schema.js';
import { eq, and, count } from 'drizzle-orm';
import { AUTH_ROLE, requireProRole, requireProStructureContext } from '../../../_utils/auth.js';

/**
 * Pro Audit Log — List (G2)
 *
 * GET /api/pro/audit/list
 *   ?page=1&limit=50&action=EXPORT_CSV
 *
 * Returns paginated ProAuditLog entries scoped to the structure.
 * Only accessible by STRUCTURE_ADMIN and SUPERADMIN.
 */
async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
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
        let whereConditions = [eq(ProAuditLog.structureId, structureId)];
        if (actionFilter) {
            whereConditions.push(eq(ProAuditLog.action, actionFilter));
        }

        const [logs, totalCountRes] = await Promise.all([
            db.query.ProAuditLog.findMany({
                where: and(...whereConditions),
                orderBy: (pal, { desc }) => [desc(pal.createdAt)],
                offset: (page - 1) * limit,
                limit: limit,
                with: {
                    proUser: {
                        columns: { id: true, email: true },
                    },
                },
            }),
            db.select({ count: count() }).from(ProAuditLog).where(and(...whereConditions)),
        ]);
        const totalCount = totalCountRes[0].count;

        const entries = logs.map((log) => ({
            id: log.id,
            action: log.action,
            actorId: log.proUserId,
            actorEmail: log.proUser?.email || null,
            entityType: log.entityType,
            entityId: log.entityId,
            metadata: log.metadata,
            createdAt: log.createdAt,
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
        logger.error({ err: error }, '[ProAuditLog] Erreur de lecture');
        return res.status(500).json({ error: 'Impossible de charger le journal d\'audit.' });
    }
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
