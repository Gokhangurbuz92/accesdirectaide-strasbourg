// @ts-nocheck
import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ImportLog, ReviewQueueItem, Aide, Demarche, Structure, ProAppointment } from '../../../src/db/schema.js';
import { sql, eq, desc, gte } from 'drizzle-orm';
import { env } from '../../_utils/env.js';
import { requireProRole } from '../../_utils/auth.js';
/**
 * Health Check API (Pro-only)
 *
 * GET /api/pro/health-check
 *
 * Returns real system metrics:
 *   - DB latency (ping)
 *   - Last ingestion timestamp
 *   - Pending moderation count
 *   - Environment info
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    // PKG-11 audit: a disabled or moved account keeps a « revoked » context that belongs to no organization; this route acts on the user alone, so it refuses it
    if (req.user?.role === 'revoked') return res.status(404).json({ error: 'Not found' });
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    try {
        // 1. Database ping latency
        const dbStart = Date.now();
        await db.execute(sql`SELECT 1`);
        const dbLatencyMs = Date.now() - dbStart;

        // 2. Last ingestion
        const lastIngest = await db.query.ImportLog.findFirst({
            orderBy: [desc(ImportLog.createdAt)],
            columns: { createdAt: true, source_name: true, status: true },
        });

        // 3. Pending moderation items
        const pendingModRes = await db.select({ count: sql`count(*)` }).from(ReviewQueueItem).where(eq(ReviewQueueItem.status, 'OPEN'));
        const pendingModeration = Number(pendingModRes[0].count);

        // 4. Total content counts
        const [aCountRes, dCountRes, sCountRes] = await Promise.all([
            db.select({ count: sql`count(*)` }).from(Aide),
            db.select({ count: sql`count(*)` }).from(Demarche),
            db.select({ count: sql`count(*)` }).from(Structure),
        ]);
        const aidesCount = Number(aCountRes[0].count);
        const demarchesCount = Number(dCountRes[0].count);
        const structuresCount = Number(sCountRes[0].count);

        // 5. Appointments this month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const appCountRes = await db.select({ count: sql`count(*)` }).from(ProAppointment).where(gte(ProAppointment.startAt, startOfMonth));
        const appointmentsThisMonth = Number(appCountRes[0].count);

        // 6. Service status inference
        const siaEnabled = env.siao.enabled;
        const services = [
            {
                id: 'db',
                label: 'Base de Données',
                sub: 'PostgreSQL Neon',
                status: dbLatencyMs < 500 ? 'operational' : dbLatencyMs < 2000 ? 'degraded' : 'down',
                latencyMs: dbLatencyMs,
            },
            // PKG-11 audit pass 2: only the database is really probed here. The others were reported « operational » from the presence of a key alone — and
            // the cloud model named here is refused by the AI policy (local model only): they are now « configured, not tested » or « not configured ».
            {
                id: 'ai',
                label: 'Moteur IA',
                sub: 'Modèle local (aucun service IA externe)',
                status: 'not_tested',
            },
            {
                id: 'storage',
                label: 'Stockage',
                sub: 'Cloudflare R2',
                status: process.env.R2_ACCESS_KEY_ID ? 'configured' : 'not_configured',
            },
            {
                id: 'siao',
                label: 'Passerelle SIAO',
                sub: 'Interop National',
                status: siaEnabled && env.siao.apiUrl ? 'configured' : 'not_configured',
            },
        ];

        return res.status(200).json({
            status: 'HEALTHY',
            services,
            metrics: {
                dbLatencyMs,
                lastIngestAt: lastIngest?.createdAt || null,
                lastIngestSource: lastIngest?.source_name || null,
                lastIngestStatus: lastIngest?.status || null,
                pendingModeration,
                aidesCount,
                demarchesCount,
                structuresCount,
                appointmentsThisMonth,
            },
            env: env.runtime.nodeEnv,
            nodeVersion: process.version,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error({ err: error }, '[HealthCheck] Error');
        return res.status(500).json({
            status: 'DEGRADED',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
}

// R12: platform-wide figures (appointments of every organization, moderation backlog, catalogue counts): SUPERADMIN only, like system-maintenance
export default requireProRole(handler, ['superadmin']);
