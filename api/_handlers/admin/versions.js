// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { EntityVersion } from '../../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { verifyAdmin, resolveAuthContext } from '../../_utils/auth.js';
import { restoreVersion } from '../../_utils/snapshot.js';
import { parsePaginationParams, buildPaginatedResponse } from '../../lib/geography/CursorPagination.js';
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

    if (!(await verifyAdmin(req))) return res.status(401).json({ error: "Unauthorized" });

    const { entity_type, entity_id } = req.query;

    try {
        if (req.method === 'GET') {
            if (!entity_type || !entity_id) {
                return res.status(400).json({ error: "Missing entity_type or entity_id" });
            }

            const { limit } = parsePaginationParams(req.query);

            const versions = await db.query.EntityVersion.findMany({
                where: and(
                    eq(EntityVersion.entity_type, entity_type),
                    eq(EntityVersion.entity_id, String(entity_id))
                ),
                orderBy: (ev, { desc }) => [desc(ev.createdAt)],
                limit: limit + 1
            });

            return res.status(200).json(versions);
        }

        if (req.method === 'POST') {
            const { versionId } = req.body;
            if (!versionId) return res.status(400).json({ error: "Missing versionId" });

            const auth = await resolveAuthContext(req);
            const restored = await restoreVersion(versionId, auth?.email || 'admin');
            return res.status(200).json({ success: true, restored });
        }

        return res.status(405).json({ error: "Method not allowed" });
    } catch (e) {
        logger.error('Versions API Error:', e);
        return res.status(500).json({ error: e.message });
    }
}
