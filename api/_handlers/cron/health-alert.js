// @ts-nocheck
import logger from '../../_utils/logger.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { getCronAuth } from '../../_utils/cronAuth.js';
import '../../_utils/env.js';
import { kv } from '../../_utils/kv.js';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { CronRun, ReviewQueueItem, Aide } from '../../../src/db/schema.js';
import * as Sentry from '@sentry/node';
import { randomUUID } from 'crypto';
import { isPublicBetaRestricted, openJobs } from '../../_utils/public-beta.js';
import { env } from '../../_utils/env.js';
import { recentMailEventCounts } from '../../_services/mail-events.js';
import { securitySignalCounts, evaluateSecuritySignals } from '../../_services/security-signals.js';

/**
 * Health Alert Cron — automated health monitoring with alerting.
 *
 * Checks:
 *   1. DB connectivity (SELECT 1)
 *   2. KV connectivity
 *   3. Last ingestion freshness (< 48h)
 *   … 7. Security signals (R46): failed sign-in / MFA bursts, unusual exports (api/_services/security-signals.js)
 *
 * Alert delivery:
 *   - Sentry (via console.error → Sentry captures)
 *   - Optional webhook (ALERT_WEBHOOK_URL env var) and/or e-mail to ALERT_EMAIL through the site's mail provider (R36)
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
/** R44-MAIL: bounces + suppressions per hour from the delivery events that raise « mail.bounce_burst » */
const MAIL_BOUNCE_BURST_PER_HOUR = 10;
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

    // 2b. R36: or by e-mail through the site's own mail provider (ALERT_EMAIL, e.g. the team mailbox): no extra service (Discord, Slack) needed
    const alertEmail = String(process.env.ALERT_EMAIL || '').trim();
    if (alertEmail) {
        const r = await sendMail({ to: alertEmail, subject: `[AccesDirectAide] Alerte : ${name}`, text: `${message}\n\n${JSON.stringify(details, null, 2)}\n\n${alert.timestamp}`, category: 'ops-alert' }).catch(() => null);
        if (!r || r.outcome !== 'PROVIDER_ACCEPTED') {
            logger.warn({ outcome: r?.outcome || 'ERROR' }, '[HEALTH-ALERT] e-mail alert not accepted by the provider');
            if (!webhookUrl) { try { await bounded(kv.del(alertKey)); } catch { /* KV down: no cooldown was taken either */ } }
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
        }).from(CronRun).where(sql`${CronRun.status} = 'success' AND ${CronRun.job} IN ('INGEST_AIDS', 'ACTUALITES', 'ingest-aids', 'actualites', 'ingest-structures')`);   // R40 / G4: ingest-structures writes CronRun too

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
    // R40 / G8: only when the veille is meant to run here — the beta is lifted, or the veille is opened as a job (ADA_BETA_OPEN_JOBS=veille). While it is
    // intentionally closed (Production today) a missing veille is the expected state, not an incident: it used to raise « veille.stale » every hour.
    const veilleExpected = !isPublicBetaRestricted(process.env) || openJobs(process.env).has('veille');
    if (!veilleExpected) checks.veille = { ok: true, skipped: 'JOB_NOT_OPENED' };
    else try {
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

    // Check 4: ReviewQueue > 100 P1 items (FR-078). R38: the table has « severity » and an « open » status (writers use both spellings), not
    // « priority » / « PENDING »: the former query always failed, so this check — and the whole job — was never green.
    try {
        const [row] = await db.select({ count: sql`count(*)::int` }).from(ReviewQueueItem).where(sql`${ReviewQueueItem.severity} = 'P1' AND lower(${ReviewQueueItem.status}) = 'open'`);
        const count = Number(row?.count || 0);
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

    // Check 5: published aides not re-verified for 30 days (FR-033). R38: READ-ONLY — the alert job writes nothing (the former insert named columns the
    // table does not have and never ran); re-verification and withdrawal belong to the automatic veille, which this job already watches (check 3b).
    try {
        const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
        const [row] = await db.select({ count: sql`count(*)::int` }).from(Aide).where(sql`${Aide.statut} = 'publie' AND COALESCE(${Aide.date_verification}, ${Aide.updatedAt}) < ${threshold.toISOString()}`);
        checks.staleEntities = { ok: true, staleAides: Number(row?.count || 0) };
    } catch (err) {
        // @ts-ignore
        checks.staleEntities = { ok: false, error: err?.message };
    }

    // Check 6 (R44-MAIL): a burst of bounces / suppressions (or of refused events: forged or replayed calls) reported by the Mailjet delivery events in the
    // last hour, from the address-free « mail.events_batch » audit rows. Only while the events are on (MAILER_EVENTS_ENABLED=1); off (Production today):
    // skipped. ALERT_MAIL_BOUNCE_BURST: the threshold per hour (default 10 bounces + suppressions; refused events count separately, same threshold).
    if (!env.mailer.eventsEnabled) checks.mailEvents = { ok: true, skipped: 'MAIL_EVENTS_OFF' };
    else try {
        const raw = process.env.ALERT_MAIL_BOUNCE_BURST;
        const threshold = raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : MAIL_BOUNCE_BURST_PER_HOUR;
        const c = await recentMailEventCounts({ hours: 1 });
        const bounces = c.notDelivered + c.suppressed; const refused = c.unknownOrigin + c.recipientMismatch;
        checks.mailEvents = { ok: bounces < threshold && refused < threshold, bounces, suppressed: c.suppressed, refused, calls: c.calls, thresholdPerHour: threshold };
        if (bounces >= threshold && await fireAlert('mail.bounce_burst', `E-mails : ${bounces} rebonds ou suppressions en une heure (seuil ${threshold}). Vérifiez l’envoi et la réputation du domaine avant de continuer.`, { bounces, suppressed: c.suppressed, calls: c.calls, thresholdPerHour: threshold })) alertCount++;
        if (refused >= threshold && await fireAlert('mail.events_refused', `Webhook Mailjet : ${refused} événements refusés en une heure (origine inconnue ou destinataire différent). Possible rejeu ou mot de passe du webhook divulgué.`, { refused, calls: c.calls, thresholdPerHour: threshold })) alertCount++;
    } catch (err) {
        checks.mailEvents = { ok: false, error: err?.name || 'Error' };
    }

    // Check 7 (R46 / Q07): security signals from the audit trail — bursts of refused sign-ins (every surface), of refused MFA codes, and unusual exports of
    // personal or audit data (all actors in one hour, or one actor). Counts only; thresholds ALERT_FAILED_LOGIN_BURST, ALERT_MFA_FAILURE_BURST,
    // ALERT_EXPORT_BURST, ALERT_EXPORT_PER_ACTOR, ALERT_SECURITY_WINDOW_MINUTES (api/_services/security-signals.js). Read-only.
    try {
        const c = await securitySignalCounts({ db });
        const alerts = evaluateSecuritySignals(c);
        checks.security = { ok: alerts.length === 0, failedLogins: c.failedLogins.count, mfaFailures: c.mfaFailures.count, exports: c.exports.count, exportsMaxPerActor: c.exports.maxPerActor,
            windowMinutes: c.thresholds.windowMinutes, thresholds: c.thresholds, raised: alerts.map((a) => a.name) };
        for (const a of alerts) { if (await fireAlert(a.name, a.message, a.details)) alertCount++; }
    } catch (err) {
        checks.security = { ok: false, error: err?.name || 'Error' };
    }

    // R38: say whether a PERSON can receive an alert. Sentry and the logs are not a human channel; an e-mail through MAILER_PROVIDER=noop is not delivered.
    const mailReady = Boolean(String(process.env.ALERT_EMAIL || '').trim()) && getMailerStatus().deliverable;
    checks.alertChannel = { ok: mailReady || Boolean(process.env.ALERT_WEBHOOK_URL), email: !String(process.env.ALERT_EMAIL || '').trim() ? 'NOT_CONFIGURED' : mailReady ? 'READY' : 'MAIL_PROVIDER_NOT_DELIVERABLE',
        webhook: process.env.ALERT_WEBHOOK_URL ? 'CONFIGURED' : 'NOT_CONFIGURED', sentry: Boolean(process.env.SENTRY_DSN) };

    const allOk = Object.values(checks).every(c => c.ok);

    return res.status(allOk ? 200 : 503).json({
        ok: allOk,
        requestId,
        checkedAt: new Date().toISOString(),
        alertsFired: alertCount,
        checks,
    });
}
