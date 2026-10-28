import 'dotenv/config';
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { logger } from '../api/lib/logger.js';

/**
 * Data Retention & Deletion Policy Purge
 * 
 * Enforces RGPD / Privacy data retention requirements mechanically.
 * 
 * IMPORTANT: Destructive purge is DISABLED until canonical retention values
 * are explicitly approved and defined in the environment configuration.
 * Do not invent retention values (e.g., 12 months, 3 years).
 */
async function purge() {
    logger.info('[Purge] Starting RGPD data retention purge evaluation...');
    
    // Check if canonical retention policy is defined
    const auditRetention = process.env.RETENTION_AUDIT_MONTHS;
    const syncRetention = process.env.RETENTION_SYNC_MONTHS;
    const userRetention = process.env.RETENTION_USER_YEARS;

    if (!auditRetention || !syncRetention || !userRetention) {
        logger.warn('[Purge] ABORTED: Missing retention policy configuration. Destructive purge is disabled.');
        process.exit(0);
    }

    try {
        logger.info(`[Purge] Policy: AuditLog=${auditRetention}m, SyncRun=${syncRetention}m, CitizenUser=${userRetention}y`);
        
        // 1. Purge AuditLog
        const auditRes = await db.execute(sql`
            DELETE FROM "AuditLog"
            WHERE timestamp < NOW() - INTERVAL '${sql.raw(auditRetention)} months'
        `);
        logger.info(`[Purge] AuditLog: deleted ${auditRes.rowCount} old records.`);

        // 2. Purge SyncRun
        const syncRes = await db.execute(sql`
            DELETE FROM "SyncRun"
            WHERE "completedAt" < NOW() - INTERVAL '${sql.raw(syncRetention)} months'
        `);
        logger.info(`[Purge] SyncRun: deleted ${syncRes.rowCount} old records.`);

        // 3. Purge old CronRun
        const cronRes = await db.execute(sql`
            DELETE FROM "CronRun"
            WHERE "startedAt" < NOW() - INTERVAL '${sql.raw(syncRetention)} months'
        `);
        logger.info(`[Purge] CronRun: deleted ${cronRes.rowCount} old records.`);
        
        // 4. Scrub inactive CitizenUser data
        const citizenRes = await db.execute(sql`
            UPDATE "CitizenUser"
            SET email = '[MASQUÉ]', name = 'Anonyme', phone = NULL
            WHERE "updatedAt" < NOW() - INTERVAL '${sql.raw(userRetention)} years'
            AND email != '[MASQUÉ]'
        `);
        logger.info(`[Purge] CitizenUser: anonymized ${citizenRes.rowCount} inactive users.`);

        logger.info('[Purge] Completed successfully.');
    } catch (err) {
        logger.error('[Purge] Failed', err);
        process.exit(1);
    }
    
    process.exit(0);
}

purge();
