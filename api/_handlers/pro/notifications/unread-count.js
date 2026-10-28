import logger from '../../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../../src/db/index.js';
import { ProNotification } from '../../../../src/db/schema.js';
import { eq, and, isNull, count } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../../_utils/auth.js';

/**
 * Pro Notifications — Verified Unread Notification Count (G6)
 *
 * GET /api/pro/notifications/unread-count
 *
 * Counts only ProNotification rows with a persisted readAt marker.
 * RdvConversationMessage has no durable read marker: its unread count is unknown.
 * The response explicitly reports notifications-only coverage (30s badge polling).
 */
async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { userId, structureId } = proCtx;

    try {
        // Only ProNotification has a persisted per-user read state.
        // Do not infer or fabricate unread conversation-message totals.
        const notifCountRes = await db.select({ count: count() }).from(ProNotification).where(
            and(
                eq(ProNotification.userId, userId),
                eq(ProNotification.structureId, structureId),   // PKG-4: current organization only (a moved / disabled account counts none)
                isNull(ProNotification.readAt)
            )
        );
        const notifCount = notifCountRes[0]?.count;
        if (!Number.isSafeInteger(notifCount) || notifCount < 0) {
            throw new Error('Invalid unread notification count');
        }

        return res.status(200).json({
            ok: true,
            messages: null,
            notifications: notifCount,
            total: notifCount,
            countScope: 'notifications_only',
            messageReadStateAvailable: false,
        });
    } catch (error) {
        logger.error({ err: error }, '[UnreadCount] Erreur');
        // Never report fabricated zero counts when the database is unavailable.
        return res.status(503).json({
            ok: false,
            error: 'Compteur de notifications indisponible',
            messages: null,
            notifications: null,
            total: null,
            countScope: 'notifications_only',
            messageReadStateAvailable: false,
        });
    }
}

export default requireProAuth(handler);
