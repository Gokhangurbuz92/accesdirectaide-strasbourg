// @ts-nocheck
/**
 * R46 / Q07 — security signals read from the audit trail (AuditLog): bursts of failed sign-ins, of failed MFA codes and of unusual data exports. They feed
 * the hourly health check (api/_handlers/cron/health-alert.js → the existing alert channel: webhook / e-mail / Sentry / KV log) and the administrator
 * operations page (GET /api/admin/security-signals). READ-ONLY, aggregate: counts, the number of distinct sources (hashed address) and of distinct actors —
 * never an address, an e-mail, a code or a password. No schema change: every signal comes from rows the sign-in, MFA and export paths already write
 * (plus CITIZEN_LOGIN_FAILED, written by recordCitizenLoginFailure below without any identifier of the person).
 *
 * Thresholds (env, numbers ≥ 1; invalid or empty = default):
 *   ALERT_FAILED_LOGIN_BURST   failed sign-ins (every surface) in the sign-in / MFA window (default 30)
 *   ALERT_MFA_FAILURE_BURST    failed MFA codes / MFA lockouts in the same window (default 10)
 *   ALERT_EXPORT_BURST         exports of personal or audit data in one hour, all actors (default 20)
 *   ALERT_EXPORT_PER_ACTOR     exports by ONE actor in one hour (default 8)
 *   ALERT_SECURITY_WINDOW_MINUTES  the sign-in / MFA window (default: the check interval + overlap = 70, 1–1440)
 *
 * RA-01 — the look-back follows the schedule. The check runs once an hour (vercel.json « 7 * * * * »; tests/unit/ra01-security-window.test.js pins
 * « default window ≥ the interval read from vercel.json »); a 15-minute window, written for the former 5-minute check, never saw 45 minutes of every hour.
 *  - default window = HEALTH_CHECK_INTERVAL_MINUTES + WINDOW_OVERLAP_MINUTES (a late run still overlaps the previous one);
 *  - nothing missed: when the previous check (KV state, see health-alert.js) is older than the window — a late or skipped run, or a window configured
 *    below the interval — the look-back starts at the previous check (capped at MAX_LOOKBACK_MINUTES);
 *  - nothing counted twice: once a signal has raised a delivered alert, the next checks count that signal only after that moment.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AuditLog } from '../../src/db/schema.js';

export const SECURITY_SIGNAL_ACTIONS = Object.freeze({
  failedLogin: Object.freeze(['ADMIN_LOGIN_FAILED', 'ADMIN_LOGIN_LOCKED', 'ADMIN_LOGIN_DISABLED', 'LOGIN_FAILED', 'CITIZEN_LOGIN_FAILED', 'INSTITUTION_LOGIN_FAILED']),
  mfaFailure: Object.freeze(['ADMIN_MFA_FAILED', 'MFA_VERIFY_FAILED', 'MFA_ENROL_FAILED', 'MFA_LOCKED', 'ADMIN_ELEVATION_REFUSED']),
  export: Object.freeze(['AUDIT_EXPORTED', 'ADMIN_PERSONAL_DATA_EXPORT', 'DOSSIER_EXPORTED', 'DSR_EXPORT_COMPLETED', 'DSR_EXPORT_PARTIAL_PENDING_REVIEW']),
});

/** the cadence of /api/cron/health-alert in vercel.json, in minutes (pinned against the file by tests/unit/ra01-security-window.test.js) */
export const HEALTH_CHECK_INTERVAL_MINUTES = 60;
/** overlap between two consecutive windows: a run that starts a few minutes late leaves no hole */
export const WINDOW_OVERLAP_MINUTES = 10;
/** a look-back extended to the previous check never goes further than this */
export const MAX_LOOKBACK_MINUTES = 1440;
const EXPORT_WINDOW_MINUTES = 60;
export const SECURITY_SIGNAL_KEYS = Object.freeze(['failedLogins', 'mfaFailures', 'exports']);

const DEFAULTS = Object.freeze({ windowMinutes: HEALTH_CHECK_INTERVAL_MINUTES + WINDOW_OVERLAP_MINUTES, failedLogins: 30, mfaFailures: 10, exportsPerHour: 20, exportsPerActorPerHour: 8 });

/** @param {unknown} raw @param {number} fallback @param {number} [max] */
const positive = (raw, fallback, max = 1_000_000) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
};

/** @param {Record<string, string | undefined>} [env] */
export function securityThresholds(env = process.env) {
  return {
    windowMinutes: positive(env.ALERT_SECURITY_WINDOW_MINUTES, DEFAULTS.windowMinutes, 1440),
    failedLogins: positive(env.ALERT_FAILED_LOGIN_BURST, DEFAULTS.failedLogins),
    mfaFailures: positive(env.ALERT_MFA_FAILURE_BURST, DEFAULTS.mfaFailures),
    exportsPerHour: positive(env.ALERT_EXPORT_BURST, DEFAULTS.exportsPerHour),
    exportsPerActorPerHour: positive(env.ALERT_EXPORT_PER_ACTOR, DEFAULTS.exportsPerActorPerHour),
  };
}

const list = (/** @type {readonly string[]} */ a) => sql.join(a.map((x) => sql`${x}`), sql`, `);

/** @param {unknown} v @param {number} nowMs @returns {number | null} a past instant in ms, or null (absent, unreadable, or in the future: a wrong clock never hides events) */
const pastMs = (v, nowMs) => { if (v === undefined || v === null || v === '') return null; const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v)); return Number.isFinite(t) && t <= nowMs ? t : null; };

/**
 * RA-01 (pure) — where each signal's look-back starts. `state` is what the previous health checks left in KV: `lastCheckAt` (the previous completed
 * evaluation) and `alertedThrough[signal]` (the moment up to which that signal's events already produced a delivered alert). Without state (first run,
 * KV unreachable, administrator page) this is the plain sliding window, which by default is longer than the check interval.
 * @param {{ now: Date, thresholds: { windowMinutes: number }, state?: { lastCheckAt?: any, alertedThrough?: Record<string, any> } | null }} o
 * @returns {Record<'failedLogins' | 'mfaFailures' | 'exports', { since: Date, windowMinutes: number }>}
 */
export function securityWindows({ now, thresholds, state = null }) {
  const nowMs = now.getTime(); const floor = nowMs - MAX_LOOKBACK_MINUTES * 60_000;
  const last = pastMs(state?.lastCheckAt, nowMs);
  const one = (/** @type {string} */ key, /** @type {number} */ minutes) => {
    let since = nowMs - minutes * 60_000;
    if (last !== null && last < since) since = Math.max(last, floor);            // a late / skipped run, or a window shorter than the cadence: no hole
    const told = pastMs(state?.alertedThrough?.[key], nowMs);
    if (told !== null && told > since) since = told;                              // already alerted up to there: not counted a second time
    return { since: new Date(since), windowMinutes: Math.max(1, Math.round((nowMs - since) / 60_000)) };
  };
  return { failedLogins: one('failedLogins', thresholds.windowMinutes), mfaFailures: one('mfaFailures', thresholds.windowMinutes), exports: one('exports', EXPORT_WINDOW_MINUTES) };
}

/**
 * RA-01 (pure) — the state to keep after a completed evaluation. @param {{ now: Date, previous?: any, delivered?: string[] }} o `delivered`: the signal keys
 * whose alert was sent AND kept its cooldown (an alert whose delivery failed is counted again by the next check). Timestamps only.
 */
export function nextSecurityCheckState({ now, previous = null, delivered = [] }) {
  const nowMs = now.getTime(); /** @type {Record<string, string>} */ const alertedThrough = {};
  for (const k of SECURITY_SIGNAL_KEYS) {
    const prev = pastMs(previous?.alertedThrough?.[k], nowMs);
    if (delivered.includes(k)) alertedThrough[k] = now.toISOString();
    else if (prev !== null && prev > nowMs - MAX_LOOKBACK_MINUTES * 60_000) alertedThrough[k] = new Date(prev).toISOString();
  }
  return { lastCheckAt: now.toISOString(), alertedThrough };
}

/**
 * Aggregate counts over the windows. @param {{ db: any, now?: Date, env?: Record<string, string | undefined>, state?: any }} o
 * @returns {Promise<{ thresholds: ReturnType<typeof securityThresholds>, windowStart: string, exportWindowStart: string,
 *   failedLogins: { count: number, sources: number, byAction: Record<string, number>, windowMinutes: number, since: string },
 *   mfaFailures: { count: number, sources: number, actors: number, byAction: Record<string, number>, windowMinutes: number, since: string },
 *   exports: { count: number, actors: number, maxPerActor: number, byAction: Record<string, number>, windowMinutes: number, since: string } }>}
 */
export async function securitySignalCounts({ db, now = new Date(), env = process.env, state = null }) {
  const thresholds = securityThresholds(env);
  const w = securityWindows({ now, thresholds, state });
  const A = SECURITY_SIGNAL_ACTIONS;
  const grouped = async (/** @type {readonly string[]} */ actions, /** @type {Date} */ since) => (await db.execute(sql`SELECT ${AuditLog.action} AS action, count(*)::int AS n,
      count(DISTINCT ${AuditLog.actor_id})::int AS actors
    FROM ${AuditLog} WHERE ${AuditLog.timestamp} > ${since.toISOString()} AND ${AuditLog.action} IN (${list(actions)})
    GROUP BY ${AuditLog.action}`)).rows || [];
  const sourcesOf = async (/** @type {readonly string[]} */ actions, /** @type {Date} */ since) => Number((await db.execute(sql`SELECT count(DISTINCT ${AuditLog.ip_hash})::int AS n FROM ${AuditLog}
    WHERE ${AuditLog.timestamp} > ${since.toISOString()} AND ${AuditLog.action} IN (${list(actions)}) AND ${AuditLog.ip_hash} IS NOT NULL`)).rows?.[0]?.n || 0);
  const loginRows = await grouped(A.failedLogin, w.failedLogins.since);
  const mfaRows = await grouped(A.mfaFailure, w.mfaFailures.since);
  const exportRows = await grouped(A.export, w.exports.since);
  const perActor = (await db.execute(sql`SELECT count(*)::int AS n FROM ${AuditLog}
    WHERE ${AuditLog.timestamp} > ${w.exports.since.toISOString()} AND ${AuditLog.action} IN (${list(A.export)}) GROUP BY ${AuditLog.actor_id} ORDER BY 1 DESC`)).rows || [];
  const pick = (/** @type {any[]} */ rows) => Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
  const sum = (/** @type {Record<string, number>} */ o) => Object.values(o).reduce((a, b) => a + b, 0);
  const fl = pick(loginRows); const mf = pick(mfaRows); const ex = pick(exportRows);
  const meta = (/** @type {{ since: Date, windowMinutes: number }} */ x) => ({ windowMinutes: x.windowMinutes, since: x.since.toISOString() });
  return {
    thresholds, windowStart: w.failedLogins.since.toISOString(), exportWindowStart: w.exports.since.toISOString(),
    failedLogins: { count: sum(fl), sources: sum(fl) ? await sourcesOf(A.failedLogin, w.failedLogins.since) : 0, byAction: fl, ...meta(w.failedLogins) },
    mfaFailures: { count: sum(mf), sources: sum(mf) ? await sourcesOf(A.mfaFailure, w.mfaFailures.since) : 0,
      actors: mfaRows.reduce((m, r) => Math.max(m, Number(r.actors)), 0), byAction: mf, ...meta(w.mfaFailures) },
    exports: { count: sum(ex), actors: perActor.length, maxPerActor: perActor.length ? Number(perActor[0].n) : 0, byAction: ex, ...meta(w.exports) },
  };
}

/**
 * The alerts the counts call for (pure). Messages in French (the operator's language), counts only.
 * @param {Awaited<ReturnType<typeof securitySignalCounts>>} c
 * @returns {{ name: string, signal: 'failedLogins' | 'mfaFailures' | 'exports', message: string, details: Record<string, any> }[]}
 */
export function evaluateSecuritySignals(c) {
  const t = c.thresholds; const out = [];
  const lw = c.failedLogins.windowMinutes ?? t.windowMinutes; const mw = c.mfaFailures.windowMinutes ?? t.windowMinutes; const ew = c.exports.windowMinutes ?? EXPORT_WINDOW_MINUTES;
  if (c.failedLogins.count >= t.failedLogins) out.push({ name: 'security.failed_login_burst', signal: 'failedLogins',
    message: `Sécurité : ${c.failedLogins.count} connexions refusées en ${lw} minutes (seuil ${t.failedLogins}), depuis ${c.failedLogins.sources} source(s). Possible attaque par essais de mots de passe : vérifiez le journal d’audit et les limites de débit.`,
    details: { count: c.failedLogins.count, sources: c.failedLogins.sources, byAction: c.failedLogins.byAction, windowMinutes: lw, threshold: t.failedLogins } });
  if (c.mfaFailures.count >= t.mfaFailures) out.push({ name: 'security.mfa_failure_burst', signal: 'mfaFailures',
    message: `Sécurité : ${c.mfaFailures.count} codes MFA refusés en ${mw} minutes (seuil ${t.mfaFailures}). Un mot de passe a peut-être été découvert : vérifiez les comptes concernés dans le journal d’audit.`,
    details: { count: c.mfaFailures.count, sources: c.mfaFailures.sources, accounts: c.mfaFailures.actors, byAction: c.mfaFailures.byAction, windowMinutes: mw, threshold: t.mfaFailures } });
  if (c.exports.count >= t.exportsPerHour || c.exports.maxPerActor >= t.exportsPerActorPerHour) out.push({ name: 'security.export_burst', signal: 'exports',
    message: `Sécurité : exports inhabituels — ${c.exports.count} exports de données en ${ew === EXPORT_WINDOW_MINUTES ? 'une heure' : `${ew} minutes`} (seuil ${t.exportsPerHour}), jusqu’à ${c.exports.maxPerActor} par la même personne (seuil ${t.exportsPerActorPerHour}). Vérifiez qui exporte et pourquoi dans le journal d’audit.`,
    details: { count: c.exports.count, actors: c.exports.actors, maxPerActor: c.exports.maxPerActor, byAction: c.exports.byAction, windowMinutes: ew, thresholdPerHour: t.exportsPerHour, thresholdPerActor: t.exportsPerActorPerHour } });
  return out;
}

/** a short one-way digest of the network address (same shape as the professional audit rows), never the address itself @param {string | null | undefined} ip */
export const ipDigest = (ip) => (ip ? crypto.createHash('sha256').update(String(ip)).digest('hex').substring(0, 16) : null);

/**
 * One audit row per refused citizen sign-in — NO e-mail, NO account id (a refusal must not tell the log who tried), only the hashed source and a coarse
 * reason, so a burst can be seen. Never throws (a sign-in answer never depends on the audit write). @param {any} db @param {{ ip?: string | null, reason: string }} o
 */
export async function recordCitizenLoginFailure(db, { ip, reason }) {
  try {
    if (!db || typeof db.insert !== 'function') return;
    await db.insert(AuditLog).values({ action: 'CITIZEN_LOGIN_FAILED', actor: null, actor_id: null, entity: 'CitizenSession', ip_hash: ipDigest(ip),
      details: { reason: ['unknown', 'password', 'locked', 'unverified'].includes(reason) ? reason : 'other' } });
  } catch { /* the audit trail is best effort here; the rate limits and the lockout still apply */ }
}
