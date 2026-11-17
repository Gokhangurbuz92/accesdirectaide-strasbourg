// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { SourceSnapshot } from '../../../src/db/schema.js';
import { and, or, gte, eq, like } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { parsePaginationParams } from '../../lib/geography/CursorPagination.js';

/**
 * Admin endpoint to view link check results
 * GET /api/admin/link-checks?is_broken=true
 * RA-06 (additive): `kind=link` keeps only the results of the link check (api/_services/link-check.js writes raw_excerpt « link:<address> »; the automatic
 * verification keeps its own source snapshots in the same table), and every check carries the address that was checked (`url`, null for another snapshot).
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

        if (req.query.kind === 'link') {
            conditions.push(like(SourceSnapshot.raw_excerpt, 'link:%'));
        }

        const results = await db.query.SourceSnapshot.findMany({
            where: conditions.length > 1 ? and(...conditions) : conditions.length ? conditions[0] : undefined,
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
                final_url: item.final_url,
                url: typeof item.raw_excerpt === 'string' && item.raw_excerpt.startsWith('link:') ? item.raw_excerpt.slice(5) : null
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
