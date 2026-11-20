/**
 * G13 — the last recorded run of EVERY scheduled job, for /admin/alertes. Before, the page derived it from the newest 101 CronRun rows of all jobs together:
 * a weekly or a closed job fell out of that window and disappeared from the table. Now the database returns the newest row of each job name
 * (DISTINCT ON), merged here with the list of scheduled jobs and their beta state (api/_utils/public-beta.js), so every scheduled job has a row — with
 * `lastRun: null` when nothing is recorded. Read-only; job names, statuses, timestamps and durations only (no metrics, no error text).
 */
import { sql } from 'drizzle-orm';
import { jobStates, SCHEDULED_JOBS } from '../_utils/public-beta.js';
import { WATCHED_JOBS } from './job-watch.js';

/** older CronRun names of a scheduled job (« ACTUALITES » → actualites) */
const ALIAS_OF = Object.freeze(Object.fromEntries(Object.entries(WATCHED_JOBS).flatMap(([job, w]) => w.aliases.map((a) => [a, job]))));

/** @param {unknown} v */
const iso = (v) => (v ? (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()) : null);

/** the newest CronRun row of each job name (one row per name) @param {any} db @returns {Promise<any[]>} */
export async function latestRunRows(db) {
  const r = await db.execute(sql`SELECT DISTINCT ON (job) id, job, status, trigger, "skipReason", "startedAt", "finishedAt", "durationMs"
    FROM "CronRun" ORDER BY job, "startedAt" DESC`);
  return r?.rows || [];
}

/**
 * Pure: one row per scheduled job (in SCHEDULED_JOBS order) with its beta state and its newest run (aliases merged, the newest wins), then the recorded
 * job names that are not scheduled jobs (state NOT_SCHEDULED), by name.
 * @param {any[]} rows newest run per job name @param {ReturnType<typeof jobStates>} states
 */
export function mergeLatestRuns(rows, states) {
  /** @type {Map<string, any>} */ const newest = new Map();
  for (const row of rows || []) {
    if (!row?.job) continue;
    const name = Object.prototype.hasOwnProperty.call(ALIAS_OF, row.job) ? ALIAS_OF[row.job] : String(row.job);
    const run = { id: row.id ?? null, job: String(row.job), status: row.status ?? null, trigger: row.trigger ?? null, skipReason: row.skipReason ?? null,
      startedAt: iso(row.startedAt), finishedAt: iso(row.finishedAt), durationMs: row.durationMs === null || row.durationMs === undefined ? null : Number(row.durationMs) };
    const prev = newest.get(name);
    if (!prev || String(run.startedAt || '') > String(prev.startedAt || '')) newest.set(name, run);
  }
  const scheduled = states.map((s) => ({ job: s.job, category: s.category, state: s.state, approved: s.approved, scheduled: true, lastRun: newest.get(s.job) || null }));
  const others = [...newest.keys()].filter((j) => !Object.prototype.hasOwnProperty.call(SCHEDULED_JOBS, j)).sort()
    .map((j) => ({ job: j, category: null, state: 'NOT_SCHEDULED', approved: null, scheduled: false, lastRun: newest.get(j) }));
  return [...scheduled, ...others];
}

/** @param {any} db @param {Record<string, string | undefined>} [envVars] */
export async function latestRunPerScheduledJob(db, envVars = process.env) {
  return mergeLatestRuns(await latestRunRows(db), jobStates(envVars));
}
