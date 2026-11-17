// @ts-nocheck
/** RA-03 (interface) — reading GET /api/admin/alerts and GET /api/admin/cron-runs (pure functions). */

/** the alert kinds: « job.failed.<job> » / « job.stale.<job> » name a job; the others are the health checks of api/_handlers/cron/health-alert.js */
export function alertKind(name) {
  const m = /^job\.(failed|stale)\.(.+)$/.exec(String(name || ''));
  if (m) return { kind: m[1] === 'failed' ? 'JOB_FAILED' : 'JOB_STALE', job: m[2] };
  return { kind: 'CHECK', job: null };
}

/** the newest run of each job among the runs read (the answer is newest first), sorted by job name */
export function lastRunPerJob(items) {
  const byJob = new Map();
  for (const r of items || []) if (r?.job && !byJob.has(r.job)) byJob.set(r.job, r);
  return [...byJob.values()].sort((a, b) => String(a.job).localeCompare(String(b.job)));
}
