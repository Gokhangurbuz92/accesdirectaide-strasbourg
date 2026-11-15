// @ts-nocheck
import logger from '../../_utils/logger.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { getCronAuth, scheduledByVercel } from '../../_utils/cronAuth.js';
import { startCronRun, finishCronRun } from '../../_utils/cron-run.js';
import { WATCHED_JOBS, jobRunFacts, evaluateJob, jobAlert, firstExpectedKey, hoursSince } from '../../_services/job-watch.js';
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
import { securitySignalCounts, evaluateSecuritySignals, nextSecurityCheckState } from '../../_services/security-signals.js';

/**
 * Health Alert Cron — automated health monitoring with alerting.
 *
 * Checks:
 *   1. DB connectivity (SELECT 1)
 *   2. KV connectivity
 *   3. Each scheduled job on its own (RA-03, api/_services/job-watch.js): last run failed, late, or missing — ingestion jobs under « ingestionFreshness »,
 *      the reminder / timeout / purge jobs under « jobs »
 *   … 7. Security signals (R46): failed sign-in / MFA bursts, unusual exports (api/_services/security-signals.js)
 *
 * Alert delivery:
 *   - Sentry (via console.error → Sentry captures)
 *   - Optional webhook (ALERT_WEBHOOK_URL env var) and/or e-mail to ALERT_EMAIL through the site's mail provider (R36)
 *   - Alert log in KV for admin dashboard
 *
 * Anti-spam: same alert type suppressed for 1 hour via KV.
 *
 * RA-03: a check that cannot run is LOGGED (it used to be visible only in the response body, which the scheduler discards); every run ends with one summary
 * line (check names and ok flags) and leaves a CronRun row — « success », or « partial » when a check could not run. Only the newest « success » row is
 * kept (24 rows a day would hide every other job on the administrator's run list); partial rows stay.
 *
 * Schedule: hourly at minute 7 (vercel.json; the security look-back follows it — RA-01). V2: Neon Free suspends its compute after 5 idle minutes (fixed); a 5-minute check kept it awake around the clock (≥ 180 CU-h/month against the 100 CU-h allowance)
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
/** RA-01: what the previous security check left — { lastCheckAt, alertedThrough: { signal: ISO } }, timestamps only (api/_services/security-signals.js) */
export const SECURITY_STATE_KEY = 'health-alert:security:state';
const SECURITY_STATE_TTL_SECONDS = 2 * 24 * 3600;


/**
 * @param {string} name
 * @param {string} message
 * @param {Record<string, any>} details
 */
async function fireAlert(name, message, details = {}) { return (await fireAlertDetailed(name, message, details)).fired; }

/** @returns {Promise<{ fired: boolean, kept: boolean }>} fired: the alert was sent to the channels; kept: its cooldown stands (false = a delivery failed and the next check sends it again) */
async function fireAlertDetailed(name, message, details = {}) {
    const alertKey = `alert:cooldown:${name}`;

    // Anti-spam: this alert type at most once per cooldown. R8: the cooldown lives in KV — when KV itself is unreachable the alert is still delivered (no
    // cooldown this time) instead of being lost (it threw before sending, so a KV outage could never be announced). R11 / Q11: ONE atomic SET NX takes the
    // cooldown — with several instances running the check at the same minute, a read-then-write let each of them see « no cooldown » and send the alert.
    let first = true;
    try { first = (await bounded(kv.set(alertKey, Date.now(), { ex: ALERT_COOLDOWN_SECONDS, nx: true }))) === 'OK'; } catch (err) { logger.warn({ err: err?.message }, '[HEALTH-ALERT] cooldown store unreachable: alert sent without cooldown'); }
    if (!first) {
        logger.info({ name }, '[HEALTH-ALERT] Alert suppressed (cooldown active)');
        return { fired: false, kept: false };
    }
    let kept = true;

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
            kept = false;
            try { await bounded(kv.del(alertKey)); } catch { /* KV down: no cooldown was taken either */ }
        }
    }

    // 2b. R36: or by e-mail through the site's own mail provider (ALERT_EMAIL, e.g. the team mailbox): no extra service (Discord, Slack) needed
    const alertEmail = String(process.env.ALERT_EMAIL || '').trim();
    if (alertEmail) {
        const r = await sendMail({ to: alertEmail, subject: `[AccesDirectAide] Alerte : ${name}`, text: `${message}\n\n${JSON.stringify(details, null, 2)}\n\n${alert.timestamp}`, category: 'ops-alert' }).catch(() => null);
        if (!r || r.outcome !== 'PROVIDER_ACCEPTED') {
            logger.warn({ outcome: r?.outcome || 'ERROR' }, '[HEALTH-ALERT] e-mail alert not accepted by the provider');
            if (!webhookUrl) { kept = false; try { await bounded(kv.del(alertKey)); } catch { /* KV down: no cooldown was taken either */ } }
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
    return { fired: true, kept };
}

/** RA-03: a check that could not run — logged with the check's name and the error's name / code (never silent) @param {string} check @param {any} err */
function checkFailed(check, err) {
    logger.error({ check, err: { name: err?.name || 'Error', code: err?.cause?.code || err?.code, message: String(err?.message || '').split('\nparams:')[0].slice(0, 200) } }, '[HEALTH-ALERT] check could not run');
}

/**
 * RA-03: the watched jobs of one group, each judged alone. A job is expected when the beta is lifted or the job is opened by name; « named » jobs that
 * never ran get the gap of their schedule before they are reported missing (first-expected timestamp in KV).
 * @param {'ingestion' | 'jobs'} group @returns {Promise<{ ok: boolean, jobs: Record<string, any>, alerts: { name: string, message: string, details: any }[] }>}
 */
async function watchJobs(group) {
    const restricted = isPublicBetaRestricted(process.env); const open = openJobs(process.env);
    const expected = Object.keys(WATCHED_JOBS).filter((j) => WATCHED_JOBS[j].group === group && (!restricted || open.has(j)));
    const facts = await jobRunFacts(db, expected);
    /** @type {Record<string, any>} */ const jobs = {}; const alerts = [];
    for (const job of expected) {
        const named = restricted && open.has(job);
        let firstExpectedAgeHours = null;
        if (named && facts[job].runs === 0) {
            try {
                await bounded(kv.set(firstExpectedKey(job), Date.now(), { nx: true, ex: 400 * 24 * 3600 }));
                firstExpectedAgeHours = hoursSince(await bounded(kv.get(firstExpectedKey(job))));
            } catch (err) { logger.warn({ job, err: err?.name || 'Error' }, '[HEALTH-ALERT] first-expected time unreadable: a missing job is not reported this time'); }
        }
        const s = evaluateJob({ job, named, facts: facts[job], firstExpectedAgeHours });
        jobs[job] = { ok: s.ok, state: s.state, ageHours: s.ageHours, maxAgeHours: s.maxAgeHours, lastGoodAt: facts[job].lastGoodAt, lastFailedAt: facts[job].lastFailedAt };
        const a = jobAlert(job, s); if (a) alerts.push(a);
    }
    return { ok: Object.values(jobs).every((j) => j.ok), jobs, alerts };
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
    const startedAtMs = Date.now();
    const cronRunId = await startCronRun(db, 'health-alert', { trigger: scheduledByVercel(req) ? 'vercel-cron' : 'manual', requestId });

    // Check 1: Database connectivity
    try {
        const start = Date.now();
        await db.execute(sql`SELECT 1`);
        checks.db = { ok: true, durationMs: Date.now() - start };
    } catch (err) {
        // @ts-ignore
        checks.db = { ok: false, error: err?.message };
        checkFailed('db', err);
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
        checkFailed('kv', err);
        // @ts-ignore
        if (await fireAlert('kv.down', 'KV store is unreachable', { error: err?.message })) {
            alertCount++;
        }
    }

    // Check 3: the ingestion jobs, EACH ON ITS OWN (RA-03): a failed last run, a late run or a missing run of one job is no longer hidden by another job
    // that ran (the former single MAX over « job IN ('INGEST_AIDS', 'ACTUALITES', 'ingest-aids', 'actualites', 'ingest-structures') » let the 6-hourly
    // actualites cover a weekly ingest-structures that had stopped, and never read a « failed » status).
    // V2: only when an ingestion job is meant to run here (beta lifted, or one of them opened in ADA_BETA_OPEN_JOBS). While they are intentionally closed
    // (Production in V1a/V2), an old CronRun row would otherwise raise an alert every hour for an expected state — the same rule as the veille (G8).
    // R8: a job that never ran and is not opened by name is not a failure (the former ingestion jobs were replaced by the automatic veille, check 3b).
    const ingestionExpected = !isPublicBetaRestricted(process.env) || ['ingest-aids', 'actualites', 'ingest-structures'].some((j) => openJobs(process.env).has(j));
    if (!ingestionExpected) checks.ingestionFreshness = { ok: true, skipped: 'JOB_NOT_OPENED' };
    else try {
        const w = await watchJobs('ingestion');
        checks.ingestionFreshness = { ok: w.ok, jobs: w.jobs };
        for (const a of w.alerts) { if (await fireAlert(a.name, a.message, a.details)) alertCount++; }
    } catch (err) {
        // @ts-ignore
        checks.ingestionFreshness = { ok: false, error: err?.message };
        checkFailed('ingestionFreshness', err);
    }

    // Check 3a (RA-03): the jobs that act on people's data — reminders, referral timeouts, the retention purge — now leave a CronRun row; the same
    // per-job rule applies (failed / late / missing), only for the jobs meant to run here.
    try {
        const w = await watchJobs('jobs');
        checks.jobs = Object.keys(w.jobs).length ? { ok: w.ok, jobs: w.jobs } : { ok: true, skipped: 'JOB_NOT_OPENED' };
        for (const a of w.alerts) { if (await fireAlert(a.name, a.message, a.details)) alertCount++; }
    } catch (err) {
        checks.jobs = { ok: false, error: err?.name || 'Error' };
        checkFailed('jobs', err);
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
        checkFailed('veille', err);
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
        checkFailed('reviewQueue', err);
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
        checkFailed('staleEntities', err);
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
        checkFailed('mailEvents', err);
    }

    // Check 7 (R46 / Q07): security signals from the audit trail — bursts of refused sign-ins (every surface), of refused MFA codes, and unusual exports of
    // personal or audit data (all actors in one hour, or one actor). Counts only; thresholds ALERT_FAILED_LOGIN_BURST, ALERT_MFA_FAILURE_BURST,
    // ALERT_EXPORT_BURST, ALERT_EXPORT_PER_ACTOR, ALERT_SECURITY_WINDOW_MINUTES (api/_services/security-signals.js). Read-only.
    // RA-01: the check is hourly. The page figures (`c`) are the sliding window (default: the interval + an overlap); the ALERT decision uses the same query
    // bounded by the state of the previous check — extended back to it when a run was late or skipped (nothing missed), and starting after the last
    // delivered alert of each signal (nothing alerted twice). KV unreachable: no state, the sliding window alone, still longer than the interval.
    try {
        const now = new Date();
        let state = null;
        try { state = (await bounded(kv.get(SECURITY_STATE_KEY))) || null; } catch (err) { logger.warn({ err: err?.name || 'Error' }, '[HEALTH-ALERT] security check state unreadable: sliding window only'); }
        const c = await securitySignalCounts({ db, now });
        const fresh = state ? await securitySignalCounts({ db, now, state }) : c;
        const alerts = evaluateSecuritySignals(fresh);
        checks.security = { ok: alerts.length === 0 && evaluateSecuritySignals(c).length === 0, failedLogins: c.failedLogins.count, mfaFailures: c.mfaFailures.count, exports: c.exports.count, exportsMaxPerActor: c.exports.maxPerActor,
            windowMinutes: c.thresholds.windowMinutes, thresholds: c.thresholds, raised: alerts.map((a) => a.name),
            sinceLastAlert: { failedLogins: fresh.failedLogins.count, mfaFailures: fresh.mfaFailures.count, exports: fresh.exports.count } };
        const delivered = [];
        for (const a of alerts) { const r = await fireAlertDetailed(a.name, a.message, a.details); if (r.fired) alertCount++; if (r.fired && r.kept) delivered.push(a.signal); }
        try { await bounded(kv.set(SECURITY_STATE_KEY, nextSecurityCheckState({ now, previous: state, delivered }), { ex: SECURITY_STATE_TTL_SECONDS })); } catch { /* KV down: the next check uses the sliding window */ }
    } catch (err) {
        checks.security = { ok: false, error: err?.name || 'Error' };
        checkFailed('security', err);
    }

    // R38: say whether a PERSON can receive an alert. Sentry and the logs are not a human channel; an e-mail through MAILER_PROVIDER=noop is not delivered.
    const mailReady = Boolean(String(process.env.ALERT_EMAIL || '').trim()) && getMailerStatus().deliverable;
    checks.alertChannel = { ok: mailReady || Boolean(process.env.ALERT_WEBHOOK_URL), email: !String(process.env.ALERT_EMAIL || '').trim() ? 'NOT_CONFIGURED' : mailReady ? 'READY' : 'MAIL_PROVIDER_NOT_DELIVERABLE',
        webhook: process.env.ALERT_WEBHOOK_URL ? 'CONFIGURED' : 'NOT_CONFIGURED', sentry: Boolean(process.env.SENTRY_DSN) };

    const allOk = Object.values(checks).every(c => c.ok);

    // RA-03: one closing line per run (names and flags only) and the run record. A check that could not run makes the run « partial »; a threshold that was
    // reached is the job doing its work (« success », the alert log holds the alert). Only the newest « success » row is kept.
    const flags = Object.fromEntries(Object.entries(checks).map(([k, c]) => [k, Boolean(c.ok)]));
    const checkErrors = Object.entries(checks).filter(([, c]) => c && c.error !== undefined).map(([k]) => k);
    (allOk ? logger.info : logger.warn).call(logger, { ok: allOk, alertsFired: alertCount, checks: flags, checkErrors, durationMs: Date.now() - startedAtMs }, '[HEALTH-ALERT] run summary');
    await finishCronRun(db, cronRunId, { status: checkErrors.length ? 'partial' : 'success', startedAtMs, metrics: { ok: allOk, alertsFired: alertCount, checks: flags, checkErrors },
        ...(checkErrors.length ? { error: `checks that could not run: ${checkErrors.join(', ')}` } : {}) });
    if (cronRunId && !checkErrors.length) {
        try { await db.execute(sql`DELETE FROM ${CronRun} WHERE ${CronRun.job} = 'health-alert' AND ${CronRun.status} = 'success' AND ${CronRun.id} <> ${cronRunId}`); }
        catch (err) { logger.warn({ err: err?.name || 'Error' }, '[HEALTH-ALERT] older run records not pruned'); }
    }

    return res.status(allOk ? 200 : 503).json({
        ok: allOk,
        requestId,
        checkedAt: new Date().toISOString(),
        alertsFired: alertCount,
        checks,
    });
}
