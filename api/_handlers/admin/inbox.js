// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Actualite } from '../../../src/db/schema.js';
import { eq, count, sql } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
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

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Security P0 Fix
    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    const { status = 'brouillon' } = req.query;
    
    // Phase 9: Cursor-based pagination with backward compatibility (FR-016)
    const { parsePaginationParams, buildPaginatedResponse, decodeCursor } = await import('../../lib/geography/CursorPagination.js');
    const pagination = parsePaginationParams(req.query);

    try {
        // Backward-compatible: if ?page is present, use offset mode
        if (req.query.page) {
            const page = Number(req.query.page) || 1;
            const skip = (page - 1) * pagination.limit;
            const [items, totalRes] = await Promise.all([
                db.query.Actualite.findMany({
                    where: eq(Actualite.statut, status),
                    orderBy: (a) => [sql`${a.fetched_at} DESC NULLS LAST`, a.id],   // most recently fetched first (NULLs no longer push new items off page 1)
                    limit: pagination.limit,
                    offset: skip
                }),
                db.select({ count: count() }).from(Actualite).where(eq(Actualite.statut, status))
            ]);
            const total = totalRes[0].count;
            return res.status(200).json({
                data: items,
                meta: {
                    total,
                    page,
                    totalPages: Math.ceil(total / pagination.limit)
                }
            });
        }

        // Cursor-based pagination (preferred)
        const { and, lt } = await import('drizzle-orm');
        let cursorCondition = undefined;
        if (pagination.cursor) {
            const decoded = decodeCursor(pagination.cursor);
            // using 'id' as the stable cursor
            if (decoded && decoded.key === 'id') {
                cursorCondition = lt(Actualite.id, decoded.value);
            }
        }

        const items = await db.query.Actualite.findMany({
            where: cursorCondition ? and(eq(Actualite.statut, status), cursorCondition) : eq(Actualite.statut, status),
            orderBy: (a, { desc }) => [desc(a.id)],
            limit: pagination.limit + 1 // fetch one extra to detect hasMore
        });

        const result = buildPaginatedResponse(items, pagination.limit);
        return res.status(200).json({
            data: result.data,
            pagination: result.pagination
        });

    } catch (error) {
        logger.error('Admin Inbox Error:', error);
        return res.status(500).json({ error: 'Database Error' });
    }
}
