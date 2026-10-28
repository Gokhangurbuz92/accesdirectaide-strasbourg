import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ProNotification } from '../../../src/db/schema.js';
import { eq, and, isNull, inArray, count } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { CATALOGUE, getPreferences, safeMetadata, setPreferences } from '../../_services/pro-notifications.js';
/**
 * Pro Notifications API
 *
 * GET /api/pro/notifications
 *   ?page=1&limit=20  — pagination
 *   ?unread=true       — filter unread only
 *   Returns notifications + unreadCount
 *
 * PATCH /api/pro/notifications
 *   Body: { ids: string[], action: 'read' | 'unread' }
 *   Mark notifications as read/unread
 *
 * PKG-4 / R20: GET ?view=preferences -> my e-mail preferences + the event catalogue;  PATCH { preferences: { email?, categories? } } -> save them (server-side).
 * A member only ever reads / changes their OWN notifications of their CURRENT organization (a moved or disabled account sees none).
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { userId, structureId } = proCtx;

    // ── GET: List notifications ──
    if (req.method === 'GET' && String(req.query?.view || '') === 'preferences') {
        const out = await getPreferences(proCtx);
        return out.ok ? res.status(200).json({ ...out }) : res.status(Number(out.status) || 400).json({ error: out.code, message: out.message });
    }
    if (req.method === 'PATCH' && req.body && typeof req.body === 'object' && req.body.preferences !== undefined) {
        const out = await setPreferences(proCtx, req.body.preferences);
        return out.ok ? res.status(200).json(out) : res.status(Number(out.status) || 400).json({ error: out.code, message: out.message });
    }

    if (req.method === 'GET') {
        try {
            const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
            const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
            const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
            const unreadOnly = url.searchParams.get('unread') === 'true';
            const skip = (page - 1) * limit;

            let whereConditions = [eq(ProNotification.userId, userId), eq(ProNotification.structureId, structureId)];
            if (unreadOnly) {
                whereConditions.push(isNull(ProNotification.readAt));
            }

            const [notifications, totalRes, unreadCountRes] = await Promise.all([
                db.query.ProNotification.findMany({
                    where: and(...whereConditions),
                    orderBy: (pn, { desc }) => [desc(pn.createdAt)],
                    limit,
                    offset: skip,
                }),
                db.select({ count: count() }).from(ProNotification).where(and(...whereConditions)),
                db.select({ count: count() }).from(ProNotification).where(and(eq(ProNotification.userId, userId), eq(ProNotification.structureId, structureId), isNull(ProNotification.readAt))),
            ]);
            
            const total = totalRes[0].count;
            const unreadCount = unreadCountRes[0].count;

            return res.status(200).json({
                ok: true,
                notifications,
                unreadCount,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            });
        } catch (error) {
            logger.error({ err: error }, '[Notifications] GET error');
            return res.status(500).json({ error: 'Erreur chargement notifications.' });
        }
    }

    // ── PATCH: Mark read/unread ──
    if (req.method === 'PATCH') {
        try {
            const { ids, action } = req.body || {};

            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids requis (tableau non vide).' });
            }

            if (action !== 'read' && action !== 'unread') {
                return res.status(400).json({ error: 'action doit être "read" ou "unread".' });
            }

            // Limit batch size to prevent abuse
            const safeIds = ids.slice(0, 100);

            const updated = await db.update(ProNotification).set({
                    readAt: action === 'read' ? new Date() : null,
            }).where(
                and(
                    inArray(ProNotification.id, safeIds),
                    eq(ProNotification.userId, userId),
                    eq(ProNotification.structureId, structureId)   // R12: the current organization only, like the list and the counter
                )
            ).returning();

            // Get new unread count
            const unreadCountRes = await db.select({ count: count() }).from(ProNotification).where(
                and(eq(ProNotification.userId, userId), eq(ProNotification.structureId, structureId), isNull(ProNotification.readAt))
            );
            const unreadCount = unreadCountRes[0].count;

            return res.status(200).json({
                ok: true,
                updated: updated.length,
                unreadCount,
            });
        } catch (error) {
            logger.error({ err: error }, '[Notifications] PATCH error');
            return res.status(500).json({ error: 'Erreur mise à jour notifications.' });
        }
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
}

export default requireProAuth(handler);

/**
 * Helper to create a notification (used by other handlers/crons).
 *
 * @param {{
 *   userId: string,
 *   structureId: string,
 *   type: string,
 *   title: string,
 *   message: string,
 *   metadata?: Record<string, any>,
 * }} data
 */
export async function createNotification(data) {
    // PKG-4 / R20: in-app only (e-mail goes through api/_services/pro-notifications.js notify()); catalogue types only; identifiers-only metadata; nothing personal logged
    const catalogue = /** @type {Record<string, { label: string }>} */ (CATALOGUE);
    if (!catalogue[String(data?.type)]) { logger.warn({ type: String(data?.type).slice(0, 40) }, '[Notifications] unknown event type refused'); return null; }
    try {
        const [newNotif] = await db.insert(ProNotification).values({
                userId: data.userId,
                structureId: data.structureId,
                type: data.type,
                title: String(data.title || catalogue[String(data.type)].label).slice(0, 200),
                message: String(data.message || '').slice(0, 1000),
                metadata: { ...(safeMetadata(data.metadata) || {}), delivery: { inApp: 'STORED', email: 'NOT_EMAILABLE' } },
        }).returning();
        return newNotif;
    } catch (error) {
        const e = /** @type {any} */ (error);
        logger.warn({ err: { name: e?.name, code: e?.cause?.code || e?.code }, type: data.type }, '[Notifications] Failed to create notification');
        return null;
    }
}
