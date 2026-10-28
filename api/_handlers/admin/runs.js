// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ImportLog } from '../../../src/db/schema.js';
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

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    try {
        const pagination = parsePaginationParams(req.query);
        const limit = pagination.limit;
        const logs = await db.query.ImportLog.findMany({
            orderBy: (il, { desc }) => [desc(il.createdAt)],
            limit: limit + 1,
            columns: {
              id: true,
              run_id: true,
              source_name: true,
              status: true,
              items_total: true,
              items_new: true,
              items_updated: true,
              items_skipped: true,
              duration_ms: true,
              error_count: true,
              createdAt: true,
            },
        });

        // PKG-11 / A06: the run history also shows the synchronization queue (SyncRun: requested by an administrator, run by the cron consumer), oldest error
        // text shortened; before, only import logs were listed and a queued run that never ran was invisible. An unreadable queue is said, never shown as empty.
        let queue = null;
        try {
            const rows = await db.query.SyncRun.findMany({ orderBy: (r, { desc }) => [desc(r.createdAt)], limit: 50 });
            queue = rows.map((r) => {
                let message = null;
                try { message = r.error ? String(JSON.parse(r.error)?.message || '').slice(0, 200) || null : null; } catch { message = String(r.error).slice(0, 200); }
                return { id: r.id, sourceId: r.source_id, status: r.status, requestedAt: r.createdAt, startedAt: r.status === 'PENDING' ? null : r.started_at, endedAt: r.ended_at,
                    attempts: r.attempts, nextRunAt: r.nextRunAt, stats: r.stats || null, error: message };
            });
        } catch {
            queue = null;
        }

        return res.status(200).json({ data: logs.slice(0, limit), hasMore: logs.length > limit, queue });

    } catch (error) {
        logger.error('Admin Runs Error:', error);
        return res.status(500).json({ error: 'Database Error' });
    }
}
