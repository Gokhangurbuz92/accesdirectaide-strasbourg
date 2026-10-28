// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ConversationLog } from '../../../src/db/schema.js';
import { count, sql, eq, isNotNull, desc, avg } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';

/**
 * GET /api/admin/analytics
 *
 * Computes aggregate statistics for the admin monitoring dashboard:
 * - Search mode distribution (RAG/Lexical/Static)
 * - Top detected intents
 * - Daily activity over the last 7 days
 * - Average source count per mode
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
        const [modeStats, intentStats, dailyActivity, avgSources] = await Promise.all([
            // 1. Distribution des modes de recherche
            db.select({
                searchMode: ConversationLog.searchMode,
                _count: { id: count(ConversationLog.id) },
            }).from(ConversationLog).groupBy(ConversationLog.searchMode),

            // 2. Top 10 des intentions détectées
            db.select({
                intent: ConversationLog.intent,
                _count: { id: count(ConversationLog.id) },
            }).from(ConversationLog)
              .where(isNotNull(ConversationLog.intent))
              .groupBy(ConversationLog.intent)
              .orderBy(desc(count(ConversationLog.id)))
              .limit(10),

            // 3. Activité journalière (7 derniers jours)
            db.execute(sql`
                SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
                FROM "ConversationLog"
                WHERE "createdAt" > NOW() - INTERVAL '7 days'
                GROUP BY day
                ORDER BY day ASC
            `).then(res => res.rows || res),

            // 4. Moyenne de sources par mode
            db.select({
                searchMode: ConversationLog.searchMode,
                _avg: { sourceCount: avg(ConversationLog.sourceCount) },
            }).from(ConversationLog).groupBy(ConversationLog.searchMode),
        ]);

        // Build clean response
        const modes = {};
        let total = 0;
        for (const row of modeStats) {
            modes[row.searchMode] = row._count.id;
            total += row._count.id;
        }

        const intents = intentStats.map(row => ({
            intent: row.intent,
            count: row._count.id,
        }));

        const avgByMode = {};
        for (const row of avgSources) {
            // @ts-ignore
            avgByMode[row.searchMode] = Math.round((row._avg.sourceCount || 0) * 10) / 10;
        }

        return res.status(200).json({
            success: true,
            data: {
                total,
                modes,
                intents,
                dailyActivity: dailyActivity.map(d => ({
                    day: d.day,
                    count: d.count,
                })),
                avgSourcesByMode: avgByMode,
                ragEfficiency: total > 0
                    ? Math.round(((modes.rag || 0) / total) * 100)
                    : 0,
            },
        });
    } catch (error) {
        logger.error('[Admin Analytics Error]:', error);
        // R7: an outage is not « zero conversations » (it was answered 200 with zeros, shown as an empty journal)
        return res.status(503).json({ success: false, error: 'ANALYTICS_UNAVAILABLE', message: 'Les statistiques des échanges sont momentanément indisponibles.' });
    }
}
