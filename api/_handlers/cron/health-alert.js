// @ts-nocheck
import logger from '../../_utils/logger.js';
import { getCronAuth, getHeader } from '../../_utils/cronAuth.js';
import { env } from '../../_utils/env.js';
import { kv } from '../../_utils/kv.js';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { CronRun, ReviewQueueItem, Aide } from '../../../src/db/schema.js';
import * as Sentry from '@sentry/node';
import { randomUUID } from 'crypto';

/**
 * Health Alert Cron — automated health monitoring with alerting.
 *
 * Checks:
 *   1. DB connectivity (SELECT 1)
 *   2. KV connectivity
 *   3. Last ingestion freshness (< 48h)
 *
 * Alert delivery:
 *   - Sentry (via console.error → Sentry captures)
 *   - Optional webhook (ALERT_WEBHOOK_URL env var)
 *   - Alert log in KV for admin dashboard
 *
 * Anti-spam: same alert type suppressed for 1 hour via KV.
 *
 * Schedule: every 5 minutes (vercel.json)
 * Auth: CRON_SECRET or Vercel cron UA
 */

const ALERT_COOLDOWN_SECONDS = 3600; // 1 hour anti-spam
const FRESHNESS_THRESHOLD_HOURS = 48;
const MAX_ALERT_LOG = 50;
/** R8: a KV call never holds the check (an unreachable KV retried for tens of seconds: the 5-minute check, and its alerts, stalled behind it) */
const KV_TIMEOUT_MS = 3000;
const bounded = (p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('KV timeout')), KV_TIMEOUT_MS))]);


/**
 * @param {string} name
 * @param {string} message
 * @param {Record<string, any>} details
 */
async function fireAlert(name, message, details = {}) {
    const alertKey = `alert:cooldown:${name}`;

    // Anti-spam: this alert type at most once per cooldown. R8: the cooldown lives in KV — when KV itself is unreachable the alert is still delivered (no
    // cooldown this time) instead of being lost (it threw before sending, so a KV outage could never be announced). R11 / Q11: ONE atomic SET NX takes the
    // cooldown — with several instances running the check at the same minute, a read-then-write let each of them see « no cooldown » and send the alert.
    let first = true;
    try { first = (await bounded(kv.set(alertKey, Date.now(), { ex: ALERT_COOLDOWN_SECONDS, nx: true }))) === 'OK'; } catch (err) { logger.warn({ err: err?.message }, '[HEALTH-ALERT] cooldown store unreachable: alert sent without cooldown'); }
    if (!first) {
        logger.info({ name }, '[HEALTH-ALERT] Alert suppressed (cooldown active)');
        return false;
    }

    const alert = {
        name,
        message,
        severity: 'critical',
        timestamp: new Date().toISOString(),
        details,
    };

    // 1. Log to Sentry via console.error (Sentry auto-captures)
    console.error(`[HEALTH-ALERT] 🔴 ${name}: ${message}`, JSON.stringify(details));
    Sentry.captureMessage(`🔴 HEALTH ALERT: ${name} — ${message}`, {
        level: 'fatal',
        extra: details,
    });

    // 2. Optional webhook (Slack, Discord, Teams, etc.)
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            const r = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `🔴 *HEALTH ALERT* — ${name}\n${message}\n${JSON.stringify(details, null, 2)}`,
                    ...alert,
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (!r.ok) throw new Error(`webhook answered ${r.status}`);
        } catch (err) {
            // R12: not delivered — the cooldown is given back so the next check (5 minutes later) tries again instead of staying silent for an hour
            logger.warn({ err: err?.message }, '[HEALTH-ALERT] Webhook delivery failed');
            try { await bounded(kv.del(alertKey)); } catch { /* KV down: no cooldown was taken either */ }
        }
    }

    // 3. Store in KV alert log for admin dashboard
    try {
        const logKey = 'alert:log';
        const existingLog = (await bounded(kv.get(logKey))) || [];
        const log = [alert, ...existingLog].slice(0, MAX_ALERT_LOG);
        await bounded(kv.set(logKey, log));
    } catch {
        // KV might be the thing that's down
    }

    logger.error({ alert }, '[HEALTH-ALERT] Alert fired');
    return true;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();

    res.setHeader('x-request-id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed', requestId });
    }

    const auth = getCronAuth(req);

    if (!auth.ok && auth.reason === 'missing_secret') {
        return res.status(500).json({ error: 'CRON_SECRET is not configured', requestId });
    }
    if (!auth.ok) {
        return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    const checks = {};
    let alertCount = 0;

    // Check 1: Database connectivity
    try {
        const start = Date.now();
        await db.execute(sql`SELECT 1`);
        checks.db = { ok: true, durationMs: Date.now() - start };
    } catch (err) {
        // @ts-ignore
        checks.db = { ok: false, error: err?.message };
        // @ts-ignore
        if (await fireAlert('db.down', 'Database is unreachable', { error: err?.message })) {
            alertCount++;
        }
    }

    // Check 2: KV connectivity
    try {
        const start = Date.now();
        await bounded(kv.set('health-alert:ping', Date.now(), { ex: 60 }));
        const val = await bounded(kv.get('health-alert:ping'));
        checks.kv = { ok: val !== null, durationMs: Date.now() - start };
        if (!checks.kv.ok) {
            if (await fireAlert('kv.down', 'KV store is unreachable')) {
                alertCount++;
            }
        }
    } catch (err) {
        // @ts-ignore
        checks.kv = { ok: false, error: err?.message };
        // @ts-ignore
        if (await fireAlert('kv.down', 'KV store is unreachable', { error: err?.message })) {
            alertCount++;
        }
    }

    // Check 3: Ingestion freshness (last successful cron < 48h)
    try {
        const result = await db.select({
            maxStartedAt: sql`MAX(${CronRun.startedAt})`,
        }).from(CronRun).where(sql`${CronRun.status} = 'success' AND ${CronRun.job} IN ('INGEST_AIDS', 'ACTUALITES', 'ingest-aids', 'actualites')`);

        const lastIngestion = result[0]?.maxStartedAt;
        if (lastIngestion) {
            const ageHours = (Date.now() - new Date(lastIngestion).getTime()) / (1000 * 60 * 60);
            checks.ingestionFreshness = { ok: ageHours < FRESHNESS_THRESHOLD_HOURS, ageHours: Math.round(ageHours), lastIngestion };

            if (ageHours >= FRESHNESS_THRESHOLD_HOURS) {
                if (await fireAlert('ingestion.stale', `Last successful ingestion was ${Math.round(ageHours)}h ago (threshold: ${FRESHNESS_THRESHOLD_HOURS}h)`, { ageHours: Math.round(ageHours), lastIngestion })) {
                    alertCount++;
                }
            }
        } else {
            // R8: the former ingestion jobs no longer run — the automatic veille replaced them (its own freshness is check 3b); not a failure of the platform
            checks.ingestionFreshness = { ok: true, message: 'Aucun ancien import : remplacé par la veille automatique (contrôle « veille »).' };
        }
    } catch (err) {
        // @ts-ignore
        checks.ingestionFreshness = { ok: false, error: err?.message };
    }

    // Check 3b (R8): the automatic veille (D-5 v2) — it publishes, corrects and withdraws every public record; a veille that stopped finishing is the first
    // thing the operator must know (the check above only watched the former ingestion jobs). ALERT_VEILLE_STALE_HOURS: the threshold (48 h; an alert drill
    // sets it to 0 to see the whole chain deliver).
    try {
        const threshold = Number.isFinite(Number(process.env.ALERT_VEILLE_STALE_HOURS)) && process.env.ALERT_VEILLE_STALE_HOURS !== '' ? Number(process.env.ALERT_VEILLE_STALE_HOURS) : FRESHNESS_THRESHOLD_HOURS;
        const [last] = await db.select({ at: sql`MAX(${CronRun.startedAt})` }).from(CronRun).where(sql`${CronRun.job} = 'veille' AND ${CronRun.status} IN ('success', 'partial')`);
        const at = last?.at ? new Date(last.at) : null;
        const ageHours = at ? (Date.now() - at.getTime()) / 3600000 : null;
        checks.veille = { ok: ageHours !== null && ageHours < threshold, ageHours: ageHours === null ? null : Math.round(ageHours), last: at ? at.toISOString() : null, thresholdHours: threshold };
        if (!checks.veille.ok && await fireAlert('veille.stale', at ? `Veille automatique : aucune veille terminée depuis ${Math.round(ageHours)} h (seuil ${threshold} h). Les fiches publiques ne sont plus revérifiées.`
            : 'Veille automatique : aucune veille terminée enregistrée. Les fiches publiques ne sont pas vérifiées.', { ageHours: checks.veille.ageHours, last: checks.veille.last, thresholdHours: threshold })) {
            alertCount++;
        }
    } catch (err) {
        // @ts-ignore
        checks.veille = { ok: false, error: err?.message };
    }

    // Check 4: ReviewQueue > 100 P1 items (FR-078)
    try {
        const [{ count }] = await db.select({ count: sql`count(*)` }).from(ReviewQueueItem).where(sql`priority = 'P1' AND status = 'PENDING'`);
        checks.reviewQueue = { ok: count <= 100, count };
        if (count > 100) {
            if (await fireAlert('review.queue.critical', `Review queue exceeded 100 P1 items (${count})`, { count })) {
                alertCount++;
            }
        }
    } catch (err) {
        // @ts-ignore
        checks.reviewQueue = { ok: false, error: err?.message };
    }

    // Check 5: Stale entities to ReviewQueue (FR-033)
    try {
        const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
        const staleAides = await db.select({ id: Aide.id }).from(Aide).where(sql`updated_at < ${threshold.toISOString()} AND status = 'PUBLISHED'`).limit(50);
        for (const aide of staleAides) {
            await db.insert(ReviewQueueItem).values({
                id: randomUUID(),
                type: 'STALE_ENTITY',
                priority: 'P2',
                status: 'PENDING',
                entityId: aide.id,
                entityType: 'AIDE'
            }).onConflictDoNothing();
        }
        checks.staleEntities = { ok: true, processed: staleAides.length };
    } catch (err) {
        // @ts-ignore
        checks.staleEntities = { ok: false, error: err?.message };
    }

    const allOk = Object.values(checks).every(c => c.ok);

    return res.status(allOk ? 200 : 503).json({
        ok: allOk,
        requestId,
        checkedAt: new Date().toISOString(),
        alertsFired: alertCount,
        checks,
    });
}
