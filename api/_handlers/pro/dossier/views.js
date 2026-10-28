import logger from '../../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../../src/db/index.js';
import { AuditLog } from '../../../../src/db/schema.js';
import { desc, inArray, and, sql } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../../_utils/auth.js';
import { resolveDossierForStructure } from '../../../_utils/share-access.js';
/**
 * Dossier View Log API (Pro-only, RGPD transparency)
 *
 * GET /api/pro/dossier/views?shareId=xxx
 *
 * Returns the audit log of who viewed a given dossier.
 * Provides RGPD transparency: "Qui a vu mon dossier?"
 */
async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const shareId = url.searchParams.get('shareId');

    if (!shareId) {
        return res.status(400).json({ error: 'shareId requis.' });
    }

    try {
        // RC5: only a structure holding an active grant may see the access trail (expired dossiers stay readable for transparency).
        const found = await resolveDossierForStructure(shareId, proCtx, { id: true, viewCount: true, expiresAt: true });
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        const shared = found.shared;

        // Get view audit logs. Writers (logProAudit) store the dossier id and the acting structure in
        // `details`, and name the columns `actor_id` / `timestamp`. Scope to the caller's structure so one
        // structure cannot read another structure's access trail.
        const viewLogs = await db.query.AuditLog.findMany({
            where: and(
                sql`${AuditLog.details}->>'shareId' = ${shareId}`,
                sql`${AuditLog.details}->>'structureId' = ${proCtx.structureId}`,
                inArray(AuditLog.action, ['DOSSIER_VIEWED', 'DOSSIER_EXPORTED', 'DOSSIER_STATUS_UPDATED'])
            ),
            orderBy: [desc(AuditLog.timestamp)],
            limit: 50,
            columns: {
                id: true,
                action: true,
                actor_id: true,
                timestamp: true,
                details: true,
            },
        });

        return res.status(200).json({
            ok: true,
            shareId,
            viewCount: shared.viewCount,
            views: viewLogs.map((log) => ({
                id: log.id,
                action: log.action,
                actorId: log.actor_id,
                at: log.timestamp,
                details: typeof log.details === 'string' ? JSON.parse(log.details) : log.details,
            })),
        });
    } catch (error) {
        logger.error({ err: error }, '[DossierViews] Erreur');
        return res.status(500).json({ error: 'Erreur consultation.' });
    }
}

export default requireProAuth(handler);
