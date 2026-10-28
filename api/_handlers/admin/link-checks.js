// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { SourceSnapshot } from '../../../src/db/schema.js';
import { or, gte, eq } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { parsePaginationParams, buildPaginatedResponse } from '../../lib/geography/CursorPagination.js';

/**
 * Admin endpoint to view link check results
 * GET /api/admin/link-checks?is_broken=true
 */
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
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const isBroken = req.query.is_broken === 'true';
        const pagination = parsePaginationParams(req.query);
        const limit = pagination.limit;

        const conditions = [];
        
        if (isBroken) {
            conditions.push(or(gte(SourceSnapshot.http_status, 400), eq(SourceSnapshot.http_status, 0)));
        }

        const results = await db.query.SourceSnapshot.findMany({
            where: conditions.length ? conditions[0] : undefined,
            orderBy: (ss, { desc }) => [desc(ss.fetched_at)],
            limit: limit + 1
        });

        // Group by entity for better readability
        const grouped = results.reduce((acc, item) => {
            const key = `${item.entity_type}:${item.entity_id}`;
            if (!acc[key]) {
                acc[key] = {
                    entity_type: item.entity_type,
                    entity_id: item.entity_id,
                    checks: []
                };
            }
            acc[key].checks.push({
                fetched_at: item.fetched_at,
                http_status: item.http_status,
                final_url: item.final_url
            });
            return acc;
        }, {});

        return res.status(200).json({
            total: results.length,
            items: Object.values(grouped)
        });

    } catch (error) {
        logger.error('Link checks admin error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
