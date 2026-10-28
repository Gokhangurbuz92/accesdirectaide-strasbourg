// @ts-nocheck
/**
 * Automatic verification chain — control of the runs: one at a time, pause / resume, emergency stop.
 *  - one run at a time, whatever starts it (the LAB server's schedule, the owner's button, the LAB command line, the cron route): the start is serialized by a
 *    PostgreSQL advisory lock and a run is « running » only while its heartbeat is fresh (a run whose heartbeat is older than 20 minutes died with its process:
 *    it is closed as interrupted and the next run continues where it stopped);
 *  - pause: the owner's switch (CronRun job « veille-pause », status active until resumed): the run in progress stops at the next record, no new run starts;
 *  - stop: the run in progress in this process stops at the next record (the pause does this too). The owner's stop or pause ends the night's run; a stop for
 *    the machine (a native QA campaign, the disk floor) or for the LAB server's own shutdown does not: the next tick continues the work (schedule.js dueNow).
 * Times written by raw SQL use UTC wall-clock values (the application's timestamp columns hold UTC without a time zone).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { CronRun } from '../../../src/db/schema.js';

export const RUN_JOB = 'veille';
export const PAUSE_JOB = 'veille-pause';
export const STALE_MINUTES = 20;
/** the stop codes that are the owner's decision: a run stopped for one of them is the night's run (any other stop is continued) */
export const OWNER_STOPS = ['PAUSED', 'STOPPED'];

let stopFlag = null;
/**
 * ask the run in progress in this process to stop at the next record: the owner's stop by default; the LAB server's shutdown asks with SERVER_STOP (continued at
 * the next start) @param {string} [code] @param {string} [reason]
 */
export function requestStop(code = 'STOPPED', reason = 'arrêt demandé depuis l’administration') { stopFlag = { code, reason }; }
export const stopRequested = () => stopFlag;
export const clearStop = () => { stopFlag = null; };

/** A timestamp read by raw SQL (UTC wall clock without a zone) as a Date. @param {any} v */
export const asUtc = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  return new Date(/[zZ]$|[+-]\d\d(:?\d\d)?$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
};

/** paused by the owner? @param {any} db @returns {Promise<{ paused: boolean, since?: Date | null, by?: string | null, reason?: string | null }>} */
export async function pauseState(db) {
  const [p] = await db.select().from(CronRun).where(and(eq(CronRun.job, PAUSE_JOB), eq(CronRun.status, 'active'))).orderBy(desc(CronRun.startedAt)).limit(1);
  return p ? { paused: true, since: p.startedAt, by: p.trigger, reason: p.errorSample } : { paused: false };
}

/** pause (the run in progress stops at the next record, no new run starts) or resume. @param {any} db @param {{ paused: boolean, by?: string, reason?: string }} p */
export async function setPause(db, { paused, by = 'admin', reason = '' }) {
  const now = new Date();
  if (paused) {
    const cur = await pauseState(db);
    if (!cur.paused) await db.insert(CronRun).values({ job: PAUSE_JOB, status: 'active', trigger: String(by).slice(0, 120), errorSample: String(reason || 'mise en pause par l’administration').slice(0, 300), startedAt: now, updatedAt: now });
    stopFlag = { code: 'PAUSED', reason: `veille mise en pause${reason ? ` (${reason})` : ''}` };
    return pauseState(db);
  }
  await db.update(CronRun).set({ status: 'ended', finishedAt: now, updatedAt: now, skipReason: `reprise : ${String(by).slice(0, 100)}` }).where(and(eq(CronRun.job, PAUSE_JOB), eq(CronRun.status, 'active')));
  stopFlag = null;
  return { paused: false };
}

/**
 * Start a run, or say which one is running. @param {any} db @param {Record<string, any>} values the CronRun row @returns {Promise<{ id?: string, busy?: string, interrupted?: number }>}
 */
export async function acquireRun(db, values) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ada-veille-run'))`);
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60000).toISOString();
    const closed = await tx.execute(sql`UPDATE "CronRun" SET status = 'interrupted', "finishedAt" = "updatedAt",
      "errorSample" = coalesce("errorSample", 'veille arrêtée sans se terminer (serveur arrêté ou Mac éteint) : la suivante reprend où elle s’était arrêtée')
      WHERE job = ${RUN_JOB} AND status = 'running' AND "updatedAt" < ${staleBefore}`);
    const [busy] = (await tx.execute(sql`SELECT id FROM "CronRun" WHERE job = ${RUN_JOB} AND status = 'running' ORDER BY "startedAt" DESC LIMIT 1`)).rows;
    if (busy) return { busy: busy.id };
    const [run] = await tx.insert(CronRun).values({ ...values, job: RUN_JOB, status: 'running' }).returning({ id: CronRun.id });
    return { id: run.id, interrupted: closed?.rowCount || 0 };
  });
}

/**
 * A run that did not start (paused, a native QA campaign, little disk space) is written once per reason and per six hours, so the owner's page says why.
 * @param {any} db @param {string} trigger @param {string} code @param {string} reason
 */
export async function recordSkip(db, trigger, code, reason) {
  const [last] = await db.select().from(CronRun).where(eq(CronRun.job, RUN_JOB)).orderBy(desc(CronRun.startedAt)).limit(1);
  const recent = last && last.status === 'skipped' && last.skipReason === code && Date.now() - new Date(last.startedAt).getTime() < 6 * 3600000;
  if (!recent) {
    const now = new Date();
    await db.insert(CronRun).values({ job: RUN_JOB, status: 'skipped', trigger: String(trigger || 'manual').slice(0, 120), skipReason: code, errorSample: String(reason).slice(0, 300), startedAt: now, finishedAt: now, durationMs: 0, updatedAt: now });
  }
  return { ok: false, skipped: code, message: reason };
}
