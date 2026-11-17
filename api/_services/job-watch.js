// @ts-nocheck
/**
 * RA-03 — what the health check (api/_handlers/cron/health-alert.js) expects of each scheduled job, read from the CronRun rows the jobs write
 * (api/_utils/cron-run.js). Before: one combined freshness over three ingestion jobs (a 6-hourly job hid a weekly job that had stopped), no check read a
 * « failed » status, and four jobs wrote no run record at all.
 *
 * Each watched job is judged ALONE:
 *   FAILED   its newest finished run is « failed »                                  → alert job.failed.<job>
 *   LATE     it ran before, but no good run for longer than its allowed gap          → alert job.stale.<job>
 *   MISSING  it is opened here (ADA_BETA_OPEN_JOBS) and still has no run after the same gap, counted from the first check that expected it → job.stale.<job>
 *   AWAITING_FIRST_RUN  opened, no run yet, inside that gap (a job opened on Monday that runs on Sunday is not an incident on Tuesday)
 *   NOT_STARTED         the beta is lifted, the job is not named and it never ran (R8: the former ingestion jobs replaced by the veille are not a failure)
 *   OK
 * Counts, job names, statuses and timestamps only — never the content of a run (errorSample is not read).
 */
import { sql } from 'drizzle-orm';

const HOUR = 3600_000;

/**
 * job → { maxAgeHours, good, group }. maxAgeHours = twice the longest gap of its schedule in vercel.json + 1 h (one missed run is tolerated, two are not);
 * tests/unit/ra03-job-watch.test.js pins every entry against vercel.json. `good`: the statuses that count as a run that did its work. `aliases`: older
 * names of the same job in CronRun. parcours-reminder: « skipped » is its only skip — Mon Parcours closed (A-18), a run that did its (empty) work. The veille keeps its own check (ALERT_VEILLE_STALE_HOURS); health-alert does not watch itself (docs/runbooks.md).
 */
export const WATCHED_JOBS = Object.freeze({
  actualites: Object.freeze({ group: 'ingestion', maxAgeHours: 13, good: Object.freeze(['success']), aliases: Object.freeze(['ACTUALITES']) }),
  'ingest-aids': Object.freeze({ group: 'ingestion', maxAgeHours: 49, good: Object.freeze(['success']), aliases: Object.freeze(['INGEST_AIDS']) }),
  'ingest-structures': Object.freeze({ group: 'ingestion', maxAgeHours: 337, good: Object.freeze(['success']), aliases: Object.freeze([]) }),
  'parcours-reminder': Object.freeze({ group: 'jobs', maxAgeHours: 49, good: Object.freeze(['success', 'partial', 'skipped']), aliases: Object.freeze([]) }),
  'referral-timeouts': Object.freeze({ group: 'jobs', maxAgeHours: 49, good: Object.freeze(['success', 'partial']), aliases: Object.freeze([]) }),
  'rdv-reminder': Object.freeze({ group: 'jobs', maxAgeHours: 49, good: Object.freeze(['success', 'partial']), aliases: Object.freeze([]) }),
  'gdpr-purge': Object.freeze({ group: 'jobs', maxAgeHours: 49, good: Object.freeze(['success', 'partial']), aliases: Object.freeze([]) }),
});

/** key of the « first check that expected this job » timestamp (KV, timestamp only) @param {string} job */
export const firstExpectedKey = (job) => `health-alert:job-first-expected:${job}`;

/**
 * Newest runs per watched job, ages computed by the database clock. @param {any} db @param {string[]} jobs
 * @returns {Promise<Record<string, { runs: number, lastGoodAgeHours: number | null, lastFailedAgeHours: number | null, lastGoodAt: string | null, lastFailedAt: string | null }>>}
 */
export async function jobRunFacts(db, jobs) {
  /** @type {Record<string, any>} */ const out = {};
  for (const job of jobs) {
    const w = WATCHED_JOBS[job]; if (!w) continue;
    const names = [job, ...w.aliases];
    const inNames = sql.join(names.map((n) => sql`${n}`), sql`, `); const inGood = sql.join(w.good.map((n) => sql`${n}`), sql`, `);
    const [r] = (await db.execute(sql`SELECT count(*)::int AS runs,
        MAX("startedAt") FILTER (WHERE status IN (${inGood})) AS good_at, MAX("startedAt") FILTER (WHERE status = 'failed') AS failed_at,
        EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - MAX("startedAt") FILTER (WHERE status IN (${inGood})))) AS good_age,
        EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - MAX("startedAt") FILTER (WHERE status = 'failed'))) AS failed_age
      FROM "CronRun" WHERE job IN (${inNames})`)).rows || [];
    const h = (/** @type {unknown} */ v) => (v === null || v === undefined ? null : Number(v) / 3600);
    const iso = (/** @type {unknown} */ v) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
    out[job] = { runs: Number(r?.runs || 0), lastGoodAgeHours: h(r?.good_age), lastFailedAgeHours: h(r?.failed_age), lastGoodAt: iso(r?.good_at), lastFailedAt: iso(r?.failed_at) };
  }
  return out;
}

/**
 * Pure: the state of one job. @param {{ job: string, named: boolean, facts?: { runs: number, lastGoodAgeHours: number | null, lastFailedAgeHours: number | null } | null,
 *   firstExpectedAgeHours?: number | null }} o `named`: the job is opened by name in this environment; `firstExpectedAgeHours`: hours since the first check
 *   that expected it (null: unknown — the store could not be read).
 * @returns {{ ok: boolean, state: 'OK' | 'FAILED' | 'LATE' | 'MISSING' | 'AWAITING_FIRST_RUN' | 'NOT_STARTED', maxAgeHours: number, ageHours: number | null, alert: null | 'failed' | 'stale' }}
 */
export function evaluateJob({ job, named, facts = null, firstExpectedAgeHours = null }) {
  const w = WATCHED_JOBS[job]; const max = w.maxAgeHours;
  const good = facts?.lastGoodAgeHours ?? null; const failed = facts?.lastFailedAgeHours ?? null;
  const age = good === null ? null : Math.round(good);
  if (failed !== null && (good === null || failed < good)) return { ok: false, state: 'FAILED', maxAgeHours: max, ageHours: age, alert: 'failed' };
  if (good !== null) return good >= max ? { ok: false, state: 'LATE', maxAgeHours: max, ageHours: age, alert: 'stale' } : { ok: true, state: 'OK', maxAgeHours: max, ageHours: age, alert: null };
  if (!named) return { ok: true, state: 'NOT_STARTED', maxAgeHours: max, ageHours: null, alert: null };
  if (firstExpectedAgeHours !== null && firstExpectedAgeHours >= max) return { ok: false, state: 'MISSING', maxAgeHours: max, ageHours: null, alert: 'stale' };
  return { ok: true, state: 'AWAITING_FIRST_RUN', maxAgeHours: max, ageHours: null, alert: null };
}

/** the alert of a job state, in French (the operator's language): names, hours and statuses only @param {string} job @param {ReturnType<typeof evaluateJob>} s */
export function jobAlert(job, s) {
  if (s.alert === 'failed') return { name: `job.failed.${job}`, message: `Tâche planifiée « ${job} » : la dernière exécution a échoué. Consultez l’historique des tâches (/admin/sync) et les journaux, puis relancez-la.`,
    details: { job, state: s.state, lastGoodAgeHours: s.ageHours } };
  if (s.alert === 'stale') return { name: `job.stale.${job}`, message: s.state === 'MISSING'
    ? `Tâche planifiée « ${job} » : ouverte mais aucune exécution enregistrée depuis plus de ${s.maxAgeHours} h. Vérifiez la planification et le déploiement.`
    : `Tâche planifiée « ${job} » : aucune exécution réussie depuis ${s.ageHours} h (maximum attendu ${s.maxAgeHours} h). Vérifiez la planification et les journaux.`,
    details: { job, state: s.state, ageHours: s.ageHours, maxAgeHours: s.maxAgeHours } };
  return null;
}

/** hours since `iso` (null when unreadable) @param {unknown} v @param {number} [nowMs] */
export const hoursSince = (v, nowMs = Date.now()) => { const t = typeof v === 'number' ? v : Date.parse(String(v ?? '')); return Number.isFinite(t) ? Math.max(0, (nowMs - t) / HOUR) : null; };
