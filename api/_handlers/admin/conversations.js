// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ConversationLog } from '../../../src/db/schema.js';
import { eq, desc, and, isNotNull, count } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { parsePaginationParams, buildPaginatedResponse } from '../../lib/geography/CursorPagination.js';

/**
 * GET /api/admin/conversations
 *
 * Returns conversation logs for the admin monitoring dashboard.
 * Supports filtering by searchMode (?mode=rag|lexical|static), pagination (?limit=50),
 * and CSV export (?format=csv).
 *
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
        const url = new URL(req.url, `http://${req.headers.host}`);
        const mode = url.searchParams.get('mode');
        const format = url.searchParams.get('format');
        const ratingParam = url.searchParams.get('rating');
        const pagination = parsePaginationParams(req.query);
        const limit = format === 'csv' ? 10000 : pagination.limit;

        const conditions = [];
        if (mode && mode !== 'all') {
            conditions.push(eq(ConversationLog.searchMode, mode));
        }
        if (ratingParam) {
            conditions.push(eq(ConversationLog.rating, parseInt(ratingParam)));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // --- CSV Export ---
        if (format === 'csv') {
            const logs = await db.query.ConversationLog.findMany({
                where: whereClause,
                orderBy: (c, { desc }) => [desc(c.createdAt)],
                limit: limit + (format === 'csv' ? 0 : 1), // fetch extra for cursor
            });

            const BOM = '\uFEFF'; // UTF-8 BOM for Excel
            const header = 'Date,Message,Intent,Mode,Sources,Rating,Comment\n';
            const rows = logs.map(log => {
                const date = new Date(log.createdAt).toISOString();
                const msg = `"${(log.message || '').replace(/"/g, '""')}"`;
                const intent = log.intent || '';
                const comment = `"${(log.userComment || '').replace(/"/g, '""')}"`;
                return `${date},${msg},${intent},${log.searchMode},${log.sourceCount},${log.rating || ''},${comment}`;
            }).join('\n');

            const csv = BOM + header + rows;
            const filename = `ada-logs-${new Date().toISOString().slice(0, 10)}.csv`;

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.status(200).send(csv);
        }

        // --- JSON Response ---
        const [logs, modeGroups, feedbackGroups] = await Promise.all([
            db.query.ConversationLog.findMany({
                where: whereClause,
                orderBy: (c, { desc }) => [desc(c.createdAt)],
                limit: limit,
            }),
            db.select({
                searchMode: ConversationLog.searchMode,
                _count: { id: count(ConversationLog.id) },
            }).from(ConversationLog).groupBy(ConversationLog.searchMode),
            db.select({
                rating: ConversationLog.rating,
                _count: { id: count(ConversationLog.id) },
            }).from(ConversationLog).where(isNotNull(ConversationLog.rating)).groupBy(ConversationLog.rating),
        ]);

        const modeStats = {
            total: 0,
            rag: 0,
            lexical: 0,
            static: 0,
        };
        for (const row of modeGroups) {
            modeStats[row.searchMode] = row._count.id;
            modeStats.total += row._count.id;
        }

        // Feedback stats
        let positive = 0, negative = 0;
        for (const row of feedbackGroups) {
            if (row.rating === 1) positive = row._count.id;
            if (row.rating === -1) negative = row._count.id;
        }

        return res.status(200).json({
            success: true,
            data: { logs, stats: { ...modeStats, positive, negative } },
        });
    } catch (error) {
        logger.error('[Admin Conversations Error]:', error);
        // R7: an outage is not « no exchange » (it was answered 200 and empty: the improvement wall then said « Qualité Optimale ! »)
        return res.status(503).json({ success: false, error: 'CONVERSATIONS_UNAVAILABLE', message: 'Le journal des échanges est momentanément indisponible.' });
    }
}
