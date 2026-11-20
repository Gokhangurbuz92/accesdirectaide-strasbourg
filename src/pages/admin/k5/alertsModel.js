// @ts-nocheck
/** RA-03 (interface) — reading GET /api/admin/alerts and GET /api/admin/cron-runs (pure functions). */

/** G13: the beta state of a scheduled job (api/_utils/public-beta.js jobStates) → the label key of /admin/alertes */
export const STATE_KEY = Object.freeze({ OPEN: 'open', OPEN_ALL_JOBS: 'open', CLOSED: 'closed', AWAITING_APPROVAL: 'awaiting', LEGACY_CLOSED: 'legacy', NOT_SCHEDULED: 'not_scheduled' });

/** the alert kinds: « job.failed.<job> » / « job.stale.<job> » name a job; the others are the health checks of api/_handlers/cron/health-alert.js */
export function alertKind(name) {
  const m = /^job\.(failed|stale)\.(.+)$/.exec(String(name || ''));
  if (m) return { kind: m[1] === 'failed' ? 'JOB_FAILED' : 'JOB_STALE', job: m[2] };
  return { kind: 'CHECK', job: null };
}

/**
 * G13: the rows of GET /api/admin/cron-runs?latest=1 ({ jobs: [{ job, state, scheduled, lastRun }] }) — one per scheduled job, even without a run, then
 * the recorded names that are not scheduled jobs. Flattened for the table: `status` is « never » when no run is recorded.
 */
export function jobRows(jobs) {
  return (jobs || []).filter((j) => j?.job).map((j) => ({ job: String(j.job), state: j.state || null, scheduled: j.scheduled !== false, runId: j.lastRun?.id || null,
    status: j.lastRun ? j.lastRun.status : 'never', skipReason: j.lastRun?.skipReason || null, startedAt: j.lastRun?.startedAt || null,
    durationMs: Number.isFinite(j.lastRun?.durationMs) ? j.lastRun.durationMs : null }));
}
