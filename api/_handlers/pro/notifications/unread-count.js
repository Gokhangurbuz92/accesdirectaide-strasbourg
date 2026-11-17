import logger from '../../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../../src/db/index.js';
import { ProNotification } from '../../../../src/db/schema.js';
import { eq, and, isNull, count } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../../_utils/auth.js';
import { withProRateLimit } from '../../../_utils/pro-rate-limit.js';
import { unreadConversationCount } from '../../../_services/conversation-read.js';

/**
 * Pro Notifications — Verified Unread Notification Count (G6)
 *
 * GET /api/pro/notifications/unread-count
 *
 * `notifications`: ProNotification rows without a persisted readAt.
 * `messages` (B02): the member's unread conversations, from the per-member read marker of drizzle/0049 (api/_services/conversation-read.js). On a database without that
 * table the count stays unknown — `messages: null`, `countScope: 'notifications_only'`, `messageReadStateAvailable: false` — exactly the answer given
 * before the marker existed; it is never inferred or fabricated.
 * `total` stays the notices: a person's message is itself a notice (message_received), so adding `messages` would count it twice.
 */
async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { userId, structureId } = proCtx;

    try {
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

        // B02: null = this database has no read marker yet (or the read failed): unknown, never zero
        const messages = await unreadConversationCount({ structureId, userId }).catch(() => null);

        return res.status(200).json({
            ok: true,
            messages,
            notifications: notifCount,
            total: notifCount,
            countScope: messages === null ? 'notifications_only' : 'notifications_and_messages',
            messageReadStateAvailable: messages !== null,
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

// A23: tenant read / write quota, after authentication (api/_utils/pro-rate-limit.js)
export default requireProAuth(withProRateLimit('pro.notifications.count', handler, { budget: 'session' }));
