// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Aide, Demarche, AdminUser, CitizenUser, CronRun, ImportLog, Structure } from '../../../src/db/schema.js';
import { count, sql } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { getAllFlags } from '@ada/shared/features';
import { cache } from '@ada/shared/cache';
import { adminTasks } from '../../_services/admin-tasks.js';
import { ALLOWED_DOMAINS } from '../../_services/content-verification.js';

/**
 * GET /api/admin/stats
 *
 * Returns real-time system stats for the admin dashboard:
 * - Drizzle model counts (Aide, AdminUser, CitizenUser, CronRun, Demarche)
 * - Feature flag states
 * - Cache backend info
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
        const [
            aideCount,
            demarcheCount,
            adminCount,
            citizenCount,
            cronRunCount,
            structureCount,
            recentCrons,
            recentImports,
            ragHealth,
            tasks,
        ] = await Promise.all([
            db.select({ value: count() }).from(Aide).then(res => res[0].value),
            db.select({ value: count() }).from(Demarche).then(res => res[0].value),
            db.select({ value: count() }).from(AdminUser).then(res => res[0].value),
            db.select({ value: count() }).from(CitizenUser).then(res => res[0].value),
            db.select({ value: count() }).from(CronRun).then(res => res[0].value),
            db.select({ value: count() }).from(Structure).then(res => res[0].value),
            db.query.CronRun.findMany({
                orderBy: (cr, { desc }) => [desc(cr.startedAt)],
                limit: 5,
                columns: {
                    id: true,
                    job: true,
                    status: true,
                    startedAt: true,
                    durationMs: true,
                    metrics: true,
                },
            }).then(crons => crons.map(c => ({
                id: c.id,
                jobName: c.job,
                status: c.status,
                startedAt: c.startedAt,
                durationMs: c.durationMs,
                itemsProcessed: (c.metrics && typeof c.metrics === 'object' && c.metrics.processed) ? c.metrics.processed : null
            }))),
            db.query.ImportLog.findMany({
                orderBy: (il, { desc }) => [desc(il.createdAt)],
                limit: 5,
                // real ImportLog columns (snake_case); the response keeps its historical camelCase keys
                columns: {
                    id: true,
                    source_name: true,
                    status: true,
                    createdAt: true,
                    items_new: true,
                    items_updated: true,
                },
            }).then((rows) => rows.map((r) => ({ id: r.id, sourceName: r.source_name, status: r.status, createdAt: r.createdAt, itemsCreated: r.items_new, itemsUpdated: r.items_updated }))),
            db.execute(sql`
                SELECT
                    COUNT(*) AS total,
                    COUNT(embedding) AS indexed,
                    COUNT(*) - COUNT(embedding) AS missing,
                    COUNT(*) FILTER (WHERE embedding IS NOT NULL AND (embedded_at IS NULL OR "updatedAt" > embedded_at)) AS stale
                FROM "Aide"
            `).then(res => {
                const row = res.rows ? res.rows[0] : res[0];
                return {
                    total: Number(row?.total ?? 0),
                    indexed: Number(row?.indexed ?? 0),
                    missing: Number(row?.missing ?? 0),
                    stale: Number(row?.stale ?? 0),   // owner LAB audit: a vector computed before the record's last change (D16 markers)
                    dimensions: 768,   // vector(768) in src/db/schema.ts (local nomic-embed-text)
                };
            }),
            adminTasks(),   // owner LAB audit: « À traiter » — one count per review screen
        ]);

        const cacheInfo = cache.getInfo();
        const featureFlags = getAllFlags();

        return res.status(200).json({
            success: true,
            data: {
                counts: {
                    aides: aideCount,
                    demarches: demarcheCount,
                    admins: adminCount,
                    citizens: citizenCount,
                    cronRuns: cronRunCount,
                    structures: structureCount,
                },
                features: featureFlags,
                rag: ragHealth,
                tasks,
                // owner LAB audit: the official sites a verification may cite (the product list + the owner's extension), shown on the « Sources » page
                verificationSources: { builtIn: ALLOWED_DOMAINS, extra: String(process.env.ADA_VERIFICATION_EXTRA_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) },
                infrastructure: {
                    cache: cacheInfo,
                    // @ts-ignore
                    nodeEnv: process.env.NODE_ENV || 'development',
                },
                activity: {
                    recentCrons,
                    recentImports,
                },
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        logger.error('[Admin Stats Error]:', error);
        return res.status(500).json({ success: false, error: 'Erreur lors de la récupération des stats' });
    }
}
