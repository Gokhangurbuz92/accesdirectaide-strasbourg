// @ts-nocheck
/**
 * R40 / G4 — the CronRun record of a job run (running → success / partial / failed), the table health-alert and the admin cron page read. Used by the
 * ingestion jobs, which only wrote ImportLog / SyncRun before (health-alert's ingestion freshness never saw them). Best effort: a run record that cannot be
 * written is logged and never stops the job itself (the job's own traceability rows are unchanged).
 */
import { eq } from 'drizzle-orm';
import { CronRun } from '../../src/db/schema.js';
import { env } from './env.js';
import logger from './logger.js';

/** @param {any} db @param {string} job @param {{ trigger?: string, requestId?: string, metrics?: object }} [opts] @returns {Promise<string|null>} */
export async function startCronRun(db, job, { trigger = 'cron', requestId = null, metrics = {} } = {}) {
  try {
    const [row] = await db.insert(CronRun).values({ job, status: 'running', trigger, requestId, startedAt: new Date(), vercelEnv: env.runtime?.vercelEnv ?? null,
      release: env.sentry?.release ?? null, metrics, updatedAt: new Date() }).returning({ id: CronRun.id });
    return row?.id || null;
  } catch (err) {
    logger.warn({ job, err: err?.message }, '[cron-run] run record not written');
    return null;
  }
}

/** @param {any} db @param {string|null} id @param {{ status: 'success' | 'partial' | 'failed', startedAtMs: number, metrics?: object, error?: string }} r */
export async function finishCronRun(db, id, { status, startedAtMs, metrics = {}, error = null }) {
  if (!id) return;
  try {
    await db.update(CronRun).set({ status, finishedAt: new Date(), durationMs: Math.max(0, Date.now() - startedAtMs), metrics,
      errorSample: error ? String(error).slice(0, 500) : null, updatedAt: new Date() }).where(eq(CronRun.id, id));
  } catch (err) {
    logger.warn({ id, err: err?.message }, '[cron-run] run record not finished');
  }
}

