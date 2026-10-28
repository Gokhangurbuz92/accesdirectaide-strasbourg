// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { AuditLog, PartnershipRequest } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { getAuthenticatedUser, verifyAdmin } from '../../_utils/auth.js';

const STATUSES = ['pending', 'contacted', 'accepted', 'rejected', 'archived'];

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { method } = req;

    try {
        if (method === 'GET') {
            const requests = await db.query.PartnershipRequest.findMany({
                orderBy: (pr, { desc }) => [desc(pr.createdAt)],
                limit: 100
            });
            return res.json(requests);
        }

        if (method === 'PUT') {
            const { id, status } = req.body || {};
            if (!id || !status) return res.status(400).json({ error: "Missing fields" });
            if (!STATUSES.includes(String(status))) return res.status(400).json({ error: 'INVALID_STATUS', allowed: STATUSES });   // PKG-11 audit: a known status only

            const [updated] = await db.update(PartnershipRequest).set({ status: String(status) }).where(eq(PartnershipRequest.id, String(id))).returning();
            if (!updated) return res.status(404).json({ error: 'Not found' });
            // PKG-11 audit: the decision is audited with the named administrator (it left no trace before)
            const actor = await getAuthenticatedUser(req).catch(() => null);
            await db.insert(AuditLog).values({ action: 'PARTNERSHIP_STATUS_CHANGED', actor: actor?.email || null, actor_id: actor?.email || null, entity: 'PartnershipRequest', entity_id: updated.id, details: { status: updated.status } });
            return res.json(updated);
        }

        res.status(405).json({ error: "Method not allowed" });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}
