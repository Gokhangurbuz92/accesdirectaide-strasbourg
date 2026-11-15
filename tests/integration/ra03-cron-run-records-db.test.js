/**
 * RA-03 — on REAL PostgreSQL: the four jobs that left no run record now write a CronRun row (counts and step ids only), and the health check judges each
 * job on its own: a weekly job that stopped is no longer hidden by a 6-hourly job that ran, a « failed » last run raises an alert, a job opened by name
 * that never runs is reported after its allowance, and a check that cannot run is logged and makes the run « partial ».
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn(), default: { captureException: vi.fn(), captureMessage: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));
const sec = vi.hoisted(() => ({ fail: false }));
vi.mock('../../api/_services/security-signals.js', async (orig) => { const m = await orig(); return { ...m, securitySignalCounts: async (...a) => { if (sec.fail) throw new TypeError('synthetic check failure'); return m.securitySignalCounts(...a); } }; });

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const WATCHED = ['actualites', 'ACTUALITES', 'ingest-aids', 'INGEST_AIDS', 'ingest-structures', 'parcours-reminder', 'referral-timeouts', 'rdv-reminder', 'gdpr-purge', 'health-alert'];

describe.skipIf(!hasDatabase)('RA-03 run records and per-job health (real DB)', () => {
  let db; let logger; const saved = {};
  const ENV = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'ALERT_WEBHOOK_URL', 'ALERT_EMAIL', 'GDPR_PURGE_ENABLED'];
  const call = async (handler, query = {}) => { const r = mk(); await handler({ method: 'GET', url: '/api/cron/x', query, headers: { host: 'x', authorization: `Bearer ${process.env.CRON_SECRET}` } }, r); return r; };
  const rows = async (job) => (await db.execute(sql`SELECT status, "skipReason", trigger, metrics, "errorSample", "finishedAt", "durationMs" FROM "CronRun" WHERE job = ${job} ORDER BY "startedAt" DESC`)).rows;
  const wipe = async () => db.execute(sql`DELETE FROM "CronRun" WHERE job IN (${sql.join(WATCHED.map((j) => sql`${j}`), sql`, `)})`);
  const run = async (job, status, hoursAgo) => db.execute(sql`INSERT INTO "CronRun" (id, job, status, "startedAt", "updatedAt") VALUES (${`ra03-${job}-${status}-${hoursAgo}-${Math.random()}`}, ${job}, ${status}, (NOW() AT TIME ZONE 'UTC') - make_interval(hours => ${hoursAgo}), NOW())`);
  const fired = () => [...kvState.store.keys()].filter((k) => k.startsWith('alert:cooldown:')).map((k) => k.replace('alert:cooldown:', '')).sort();

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    delete process.env.ALERT_WEBHOOK_URL; delete process.env.ALERT_EMAIL; delete process.env.GDPR_PURGE_ENABLED;
    ({ db } = await import('../../src/db/index.js')); logger = (await import('../../api/_utils/logger.js')).default;
  });
  beforeEach(async () => { kvState.store.clear(); sec.fail = false; await wipe(); delete process.env.ADA_PUBLIC_BETA_RESTRICTED; delete process.env.ADA_BETA_OPEN_JOBS; delete process.env.ADA_JOBS_APPROVED; });
  afterAll(async () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } if (db) await wipe(); });

  it('referral-timeouts, rdv-reminder and gdpr-purge each leave a finished run record with counts only', async () => {
    const { default: referral } = await import('../../api/_handlers/cron/referral-timeouts.js');
    const { default: rdv } = await import('../../api/_handlers/cron/rdv-reminder.js');
    const { default: purge } = await import('../../api/_handlers/cron/gdpr-purge.js');
    expect((await call(referral)).statusCode).toBe(200);
    expect((await call(rdv)).statusCode).toBe(200);
    const p = await call(purge); expect(p.statusCode).toBe(200); expect(p.body.skipped, 'the default policy is not approved: a dry run').toBe(true);
    for (const job of ['referral-timeouts', 'rdv-reminder', 'gdpr-purge']) {
      const r = await rows(job);
      expect(r, job).toHaveLength(1);
      expect(['success', 'partial'], job).toContain(r[0].status);
      expect(r[0].finishedAt, job).toBeTruthy(); expect(r[0].durationMs, job).toBeGreaterThanOrEqual(0); expect(r[0].trigger).toBe('manual');
      const leaves = []; (function walk(v) { if (v && typeof v === 'object') Object.values(v).forEach(walk); else leaves.push(v); })(r[0].metrics);
      expect(JSON.stringify(r[0].metrics), job).not.toMatch(/@|\+33|\b0[1-9](\s?\d{2}){4}\b/);
      for (const v of leaves) expect(['number', 'boolean', 'string', 'undefined'].includes(typeof v) || v === null).toBe(true);
    }
    expect((await rows('referral-timeouts'))[0].metrics).toMatchObject({ overdueNotified: expect.any(Number), expired: expect.any(Number) });
    expect((await rows('rdv-reminder'))[0].metrics).toMatchObject({ ok: true, errors: expect.any(Number) });
    const pm = (await rows('gdpr-purge'))[0].metrics;
    expect(pm).toMatchObject({ mode: 'dry-run', reason: expect.any(String), failedSteps: [] }); expect(Object.values(pm.counts).every((n) => typeof n === 'number')).toBe(true);
  });

  it('a job that throws leaves a « failed » record with the error name only', async () => {
    vi.resetModules();
    vi.doMock('../../api/_services/referrals.js', () => ({ runReferralTimeouts: async () => { throw new RangeError('boom for someone@example.test'); } }));
    try {
      const { default: referral } = await import('../../api/_handlers/cron/referral-timeouts.js');
      expect((await call(referral)).statusCode).toBe(500);
      const [r] = await rows('referral-timeouts');
      expect(r).toMatchObject({ status: 'failed', errorSample: 'RangeError' });
    } finally { vi.doUnmock('../../api/_services/referrals.js'); vi.resetModules(); }
  });

  it('health-alert leaves its own record; only the newest « success » row is kept', async () => {
    const { default: health } = await import('../../api/_handlers/cron/health-alert.js');
    await call(health); await call(health);
    const r = await rows('health-alert');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: 'success', metrics: { alertsFired: expect.any(Number), checkErrors: [], checks: { db: true, kv: true } } });
  });

  it('a check that cannot run is logged by name and makes the run « partial » (kept)', async () => {
    const { default: health } = await import('../../api/_handlers/cron/health-alert.js');
    logger = (await import('../../api/_utils/logger.js')).default;   // the instance the handler loaded (an earlier test reset the modules)
    const spy = vi.spyOn(logger, 'error'); const warn = vi.spyOn(logger, 'warn');
    sec.fail = true;
    try {
      const r = await call(health);
      expect(r.statusCode).toBe(503); expect(r.body.checks.security).toEqual({ ok: false, error: 'TypeError' });
      expect(spy.mock.calls.some(([o, m]) => m === '[HEALTH-ALERT] check could not run' && o.check === 'security' && o.err.name === 'TypeError')).toBe(true);
      const summary = warn.mock.calls.find(([, m]) => m === '[HEALTH-ALERT] run summary');
      expect(summary?.[0]).toMatchObject({ ok: false, checkErrors: ['security'], checks: { security: false, db: true } });
      sec.fail = false; await call(health);
      const all = await rows('health-alert');
      expect(all.map((x) => x.status).sort()).toEqual(['partial', 'success']);
      expect(all.find((x) => x.status === 'partial').errorSample).toBe('checks that could not run: security');
    } finally { spy.mockRestore(); warn.mockRestore(); }
  });

  it('each ingestion job is judged alone: a fresh actualites no longer hides a weekly job that stopped; a failed last run is an alert', async () => {
    const { default: health } = await import('../../api/_handlers/cron/health-alert.js');
    process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; process.env.ADA_BETA_OPEN_JOBS = 'actualites,ingest-structures,ingest-aids';
    await run('actualites', 'success', 1); await run('ingest-structures', 'success', 480);                        // 20 days: two weekly runs missed
    await run('ingest-aids', 'success', 30); await run('ingest-aids', 'failed', 6);                               // the newest run failed
    const r = await call(health);
    expect(r.body.checks.ingestionFreshness.ok).toBe(false);
    expect(r.body.checks.ingestionFreshness.jobs).toMatchObject({ actualites: { ok: true, state: 'OK' }, 'ingest-structures': { ok: false, state: 'LATE', ageHours: 480, maxAgeHours: 337 }, 'ingest-aids': { ok: false, state: 'FAILED' } });
    expect(fired()).toEqual(expect.arrayContaining(['job.failed.ingest-aids', 'job.stale.ingest-structures']));
    expect(fired()).not.toContain('job.stale.actualites');
    await run('ingest-aids', 'success', 0); await run('ingest-structures', 'success', 0);                        // both recover
    expect((await call(health)).body.checks.ingestionFreshness).toMatchObject({ ok: true });
  });

  it('a job opened by name that never ran: awaiting inside its allowance, then reported missing; closed jobs are not watched', async () => {
    const { default: health } = await import('../../api/_handlers/cron/health-alert.js');
    const { firstExpectedKey } = await import('../../api/_services/job-watch.js');
    process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; process.env.ADA_BETA_OPEN_JOBS = 'rdv-reminder'; process.env.ADA_JOBS_APPROVED = 'rdv-reminder';
    const r1 = await call(health);
    expect(r1.body.checks.ingestionFreshness).toEqual({ ok: true, skipped: 'JOB_NOT_OPENED' });
    expect(r1.body.checks.jobs).toMatchObject({ ok: true, jobs: { 'rdv-reminder': { state: 'AWAITING_FIRST_RUN' } } });
    expect(Object.keys(r1.body.checks.jobs.jobs)).toEqual(['rdv-reminder']);
    kvState.store.set(firstExpectedKey('rdv-reminder'), Date.now() - 50 * 3600_000);                              // the fake clock: first expected 50 h ago
    const r2 = await call(health);
    expect(r2.body.checks.jobs.jobs['rdv-reminder']).toMatchObject({ ok: false, state: 'MISSING' });
    expect(fired()).toContain('job.stale.rdv-reminder');
    delete process.env.ADA_BETA_OPEN_JOBS;
    expect((await call(health)).body.checks.jobs).toEqual({ ok: true, skipped: 'JOB_NOT_OPENED' });
  });

  it('beta lifted, former ingestion jobs that never ran are not a failure (R8)', async () => {
    const { default: health } = await import('../../api/_handlers/cron/health-alert.js');
    const r = await call(health);
    expect(r.body.checks.ingestionFreshness).toMatchObject({ ok: true, jobs: { actualites: { state: 'NOT_STARTED' } } });
    expect(fired().filter((n) => n.startsWith('job.'))).toEqual([]);
  });
});
