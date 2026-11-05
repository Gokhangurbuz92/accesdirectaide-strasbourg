// @ts-nocheck
/**
 * R46 / Q07 — security signals read from the audit trail (AuditLog): bursts of failed sign-ins, of failed MFA codes and of unusual data exports. They feed
 * the 5-minute health check (api/_handlers/cron/health-alert.js → the existing alert channel: webhook / e-mail / Sentry / KV log) and the administrator
 * operations page (GET /api/admin/security-signals). READ-ONLY, aggregate: counts, the number of distinct sources (hashed address) and of distinct actors —
 * never an address, an e-mail, a code or a password. No schema change: every signal comes from rows the sign-in, MFA and export paths already write
 * (plus CITIZEN_LOGIN_FAILED, written by recordCitizenLoginFailure below without any identifier of the person).
 *
 * Thresholds (env, numbers ≥ 1; invalid or empty = default):
 *   ALERT_FAILED_LOGIN_BURST   failed sign-ins (every surface) in ALERT_SECURITY_WINDOW_MINUTES (default 30)
 *   ALERT_MFA_FAILURE_BURST    failed MFA codes / MFA lockouts in the same window (default 10)
 *   ALERT_EXPORT_BURST         exports of personal or audit data in one hour, all actors (default 20)
 *   ALERT_EXPORT_PER_ACTOR     exports by ONE actor in one hour (default 8)
 *   ALERT_SECURITY_WINDOW_MINUTES  the sign-in / MFA window (default 15, 1–1440)
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AuditLog } from '../../src/db/schema.js';

export const SECURITY_SIGNAL_ACTIONS = Object.freeze({
  failedLogin: Object.freeze(['ADMIN_LOGIN_FAILED', 'ADMIN_LOGIN_LOCKED', 'ADMIN_LOGIN_DISABLED', 'LOGIN_FAILED', 'CITIZEN_LOGIN_FAILED', 'INSTITUTION_LOGIN_FAILED']),
  mfaFailure: Object.freeze(['ADMIN_MFA_FAILED', 'MFA_VERIFY_FAILED', 'MFA_ENROL_FAILED', 'MFA_LOCKED', 'ADMIN_ELEVATION_REFUSED']),
  export: Object.freeze(['AUDIT_EXPORTED', 'ADMIN_PERSONAL_DATA_EXPORT', 'DOSSIER_EXPORTED', 'DSR_EXPORT_COMPLETED', 'DSR_EXPORT_PARTIAL_PENDING_REVIEW']),
});

const DEFAULTS = Object.freeze({ windowMinutes: 15, failedLogins: 30, mfaFailures: 10, exportsPerHour: 20, exportsPerActorPerHour: 8 });

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

/**
 * Aggregate counts over the windows. @param {{ db: any, now?: Date, env?: Record<string, string | undefined> }} o
 * @returns {Promise<{ thresholds: ReturnType<typeof securityThresholds>, windowStart: string, exportWindowStart: string,
 *   failedLogins: { count: number, sources: number, byAction: Record<string, number> }, mfaFailures: { count: number, sources: number, actors: number, byAction: Record<string, number> },
 *   exports: { count: number, actors: number, maxPerActor: number, byAction: Record<string, number> } }>}
 */
export async function securitySignalCounts({ db, now = new Date(), env = process.env }) {
  const thresholds = securityThresholds(env);
  const since = new Date(now.getTime() - thresholds.windowMinutes * 60_000);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const A = SECURITY_SIGNAL_ACTIONS;
  const authRows = (await db.execute(sql`SELECT ${AuditLog.action} AS action, count(*)::int AS n, count(DISTINCT ${AuditLog.ip_hash})::int AS sources,
      count(DISTINCT ${AuditLog.actor_id})::int AS actors
    FROM ${AuditLog} WHERE ${AuditLog.timestamp} > ${since.toISOString()} AND ${AuditLog.action} IN (${list([...A.failedLogin, ...A.mfaFailure])})
    GROUP BY ${AuditLog.action}`)).rows || [];
  const sourcesOf = async (/** @type {readonly string[]} */ actions) => Number((await db.execute(sql`SELECT count(DISTINCT ${AuditLog.ip_hash})::int AS n FROM ${AuditLog}
    WHERE ${AuditLog.timestamp} > ${since.toISOString()} AND ${AuditLog.action} IN (${list(actions)}) AND ${AuditLog.ip_hash} IS NOT NULL`)).rows?.[0]?.n || 0);
  const exportRows = (await db.execute(sql`SELECT ${AuditLog.action} AS action, count(*)::int AS n FROM ${AuditLog}
    WHERE ${AuditLog.timestamp} > ${hourAgo.toISOString()} AND ${AuditLog.action} IN (${list(A.export)}) GROUP BY ${AuditLog.action}`)).rows || [];
  const perActor = (await db.execute(sql`SELECT count(*)::int AS n FROM ${AuditLog}
    WHERE ${AuditLog.timestamp} > ${hourAgo.toISOString()} AND ${AuditLog.action} IN (${list(A.export)}) GROUP BY ${AuditLog.actor_id} ORDER BY 1 DESC`)).rows || [];
  const pick = (/** @type {any[]} */ rows, /** @type {readonly string[]} */ actions) => Object.fromEntries(rows.filter((r) => actions.includes(r.action)).map((r) => [r.action, Number(r.n)]));
  const sum = (/** @type {Record<string, number>} */ o) => Object.values(o).reduce((a, b) => a + b, 0);
  const fl = pick(authRows, A.failedLogin); const mf = pick(authRows, A.mfaFailure); const ex = pick(exportRows, A.export);
  return {
    thresholds, windowStart: since.toISOString(), exportWindowStart: hourAgo.toISOString(),
    failedLogins: { count: sum(fl), sources: sum(fl) ? await sourcesOf(A.failedLogin) : 0, byAction: fl },
    mfaFailures: { count: sum(mf), sources: sum(mf) ? await sourcesOf(A.mfaFailure) : 0,
      actors: authRows.filter((r) => A.mfaFailure.includes(r.action)).reduce((m, r) => Math.max(m, Number(r.actors)), 0), byAction: mf },
    exports: { count: sum(ex), actors: perActor.length, maxPerActor: perActor.length ? Number(perActor[0].n) : 0, byAction: ex },
  };
}

/**
 * The alerts the counts call for (pure). Messages in French (the operator's language), counts only.
 * @param {Awaited<ReturnType<typeof securitySignalCounts>>} c
 * @returns {{ name: string, message: string, details: Record<string, any> }[]}
 */
export function evaluateSecuritySignals(c) {
  const t = c.thresholds; const out = [];
  if (c.failedLogins.count >= t.failedLogins) out.push({ name: 'security.failed_login_burst',
    message: `Sécurité : ${c.failedLogins.count} connexions refusées en ${t.windowMinutes} minutes (seuil ${t.failedLogins}), depuis ${c.failedLogins.sources} source(s). Possible attaque par essais de mots de passe : vérifiez le journal d’audit et les limites de débit.`,
    details: { count: c.failedLogins.count, sources: c.failedLogins.sources, byAction: c.failedLogins.byAction, windowMinutes: t.windowMinutes, threshold: t.failedLogins } });
  if (c.mfaFailures.count >= t.mfaFailures) out.push({ name: 'security.mfa_failure_burst',
    message: `Sécurité : ${c.mfaFailures.count} codes MFA refusés en ${t.windowMinutes} minutes (seuil ${t.mfaFailures}). Un mot de passe a peut-être été découvert : vérifiez les comptes concernés dans le journal d’audit.`,
    details: { count: c.mfaFailures.count, sources: c.mfaFailures.sources, accounts: c.mfaFailures.actors, byAction: c.mfaFailures.byAction, windowMinutes: t.windowMinutes, threshold: t.mfaFailures } });
  if (c.exports.count >= t.exportsPerHour || c.exports.maxPerActor >= t.exportsPerActorPerHour) out.push({ name: 'security.export_burst',
    message: `Sécurité : exports inhabituels — ${c.exports.count} exports de données en une heure (seuil ${t.exportsPerHour}), jusqu’à ${c.exports.maxPerActor} par la même personne (seuil ${t.exportsPerActorPerHour}). Vérifiez qui exporte et pourquoi dans le journal d’audit.`,
    details: { count: c.exports.count, actors: c.exports.actors, maxPerActor: c.exports.maxPerActor, byAction: c.exports.byAction, thresholdPerHour: t.exportsPerHour, thresholdPerActor: t.exportsPerActorPerHour } });
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
