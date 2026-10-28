import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic, AuditLog, ProUser, Structure } from '../../../src/db/schema.js';
import { count } from 'drizzle-orm';
import { requireProRole } from '../../_utils/auth.js';
import crypto from 'crypto';
/**
 * System Maintenance API (Pro — Admin only)
 *
 * POST /api/pro/system-maintenance
 * Body: { action: 'BACKUP' | 'STRESS_TEST' }
 *
 * BACKUP: Counts records, logs audit, returns backup metadata.
 * STRESS_TEST: Runs N rapid DB reads to benchmark latency.
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const { action } = req.body || {};

    try {
        // ── BACKUP ──
        if (action === 'BACKUP') {
            const diagCountRes = await db.select({ count: count() }).from(SharedDiagnostic);
            const auditCountRes = await db.select({ count: count() }).from(AuditLog);
            const userCountRes = await db.select({ count: count() }).from(ProUser);
            
            const diagCount = diagCountRes[0].count;
            const auditCount = auditCountRes[0].count;
            const userCount = userCountRes[0].count;

            const backupId = `ADA-BKUP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

            // Audit trail
            await db.insert(AuditLog).values({
                    action: 'SYSTEM_BACKUP_GENERATED',
                    entity_id: backupId,
                    entity: 'SYSTEM',
                    actor_id: req.user?.userId || 'admin',
                    details: JSON.stringify({
                        diagnostics: diagCount,
                        auditEntries: auditCount,
                        proUsers: userCount,
                    }),
                    ip_hash: 'SYSTEM_CRON',
            });

            return res.status(200).json({
                ok: true,
                backupId,
                timestamp: new Date().toISOString(),
                counts: { diagnostics: diagCount, auditEntries: auditCount, proUsers: userCount },
            });
        }

        // ── STRESS TEST ──
        if (action === 'STRESS_TEST') {
            const iterations = 50;
            const start = Date.now();

            for (let i = 0; i < iterations; i++) {
                await db.query.Structure.findFirst();
            }

            const duration = Date.now() - start;
            const avg = (duration / iterations).toFixed(2);

            return res.status(200).json({
                ok: true,
                metrics: {
                    iterations,
                    totalMs: duration,
                    avgLatencyMs: parseFloat(avg),
                    status: parseFloat(avg) < 20 ? 'EXCELLENT' : parseFloat(avg) < 50 ? 'GOOD' : 'DEGRADED',
                },
            });
        }

        return res.status(400).json({ error: 'Action invalide. Utilisez BACKUP ou STRESS_TEST.' });
    } catch (error) {
        logger.error({ err: error }, '[Maintenance] Erreur');
        return res.status(500).json({ error: 'Échec opération système.' });
    }
}

// DTA S1D: SUPERADMIN only. BACKUP returns platform-wide totals (all dossiers, audit entries and professional users of every organization): a STRUCTURE_ADMIN must not read cross-organization numbers.
export default requireProRole(handler, ['superadmin']);
