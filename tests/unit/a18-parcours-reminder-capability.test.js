/**
 * A-18 / C08 remainder — cron/parcours-reminder follows the citizen.parcours capability: closed => a no-op (no database read, nothing sent), a logged
 * outcome and a CronRun row « skipped » (skipReason CAPABILITY_CLOSED) through the shared helper; open => the run proceeds. The real database run is in
 * tests/integration/r41-parcours-reminder-db.test.js. health-alert counts that skip as a run that did its work (no false job.stale alert while closed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateJob, WATCHED_JOBS } from '../../api/_services/job-watch.js';

const GATES = ['ADA_CAPABILITY_ENFORCEMENT', 'ADA_CAPABILITIES_OPEN', 'ADA_PUBLIC_BETA_RESTRICTED', 'VERCEL_ENV', 'ADA_BETA_OPEN_SURFACES', 'ADA_PARCOURS_EXTERNAL_REMINDERS'];
const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });

describe('A-18 — parcours-reminder is a no-op while Mon Parcours is closed', () => {
  let runs; let finished; let dbCalls; let info;
  beforeEach(() => {
    vi.resetModules();
    for (const k of GATES) vi.stubEnv(k, undefined);
    runs = []; finished = []; dbCalls = []; info = [];
    vi.doMock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: () => ({ ok: true }), getHeader: () => null, scheduledByVercel: () => false }));
    vi.doMock('../../api/_utils/cron-run.js', () => ({
      startCronRun: async (_db, job, o) => { runs.push({ job, ...o }); return 'run-1'; },
      finishCronRun: async (_db, id, r) => { finished.push({ id, ...r }); },
    }));
    vi.doMock('../../api/_utils/logger.js', () => ({ default: { info: (...a) => info.push(a), warn: () => {}, error: () => {}, debug: () => {} } }));
    vi.doMock('../../src/db/index.js', () => ({ db: { execute: async (q) => { dbCalls.push(q); return { rows: [] }; } } }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('../../api/_utils/cronAuth.js'); vi.doUnmock('../../api/_utils/cron-run.js'); vi.doUnmock('../../api/_utils/logger.js'); vi.doUnmock('../../src/db/index.js'); });

  it('closed (enforcement on, citizen.parcours not listed): 200 skipped, nothing read, CronRun « skipped » CAPABILITY_CLOSED, one log line', async () => {
    vi.stubEnv('ADA_CAPABILITY_ENFORCEMENT', '1'); vi.stubEnv('ADA_CAPABILITIES_OPEN', 'citizen.delegations');
    const handler = (await import('../../api/_handlers/cron/parcours-reminder.js')).default;
    const r = mk();
    await handler({ method: 'GET', url: '/api/cron/parcours-reminder', query: {}, headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, skipped: true, reason: 'CAPABILITY_CLOSED', capability: 'citizen.parcours' });
    expect(dbCalls).toHaveLength(0);
    expect(runs).toEqual([{ job: 'parcours-reminder', trigger: 'cron' }]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ id: 'run-1', status: 'skipped', skipReason: 'CAPABILITY_CLOSED', metrics: { considered: 0 } });
    expect(info.some(([o]) => o?.reason === 'CAPABILITY_CLOSED' && o?.skipped === true)).toBe(true);
  });

  it('G14: open (listed) but external reminders OFF (default): 200 skipped EXTERNAL_REMINDERS_OFF, nothing read, CronRun « skipped »', async () => {
    vi.stubEnv('ADA_CAPABILITY_ENFORCEMENT', '1'); vi.stubEnv('ADA_CAPABILITIES_OPEN', 'citizen.parcours');
    const handler = (await import('../../api/_handlers/cron/parcours-reminder.js')).default;
    const r = mk();
    await handler({ method: 'GET', url: '/api/cron/parcours-reminder', query: {}, headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, skipped: true, reason: 'EXTERNAL_REMINDERS_OFF' });
    expect(dbCalls).toHaveLength(0);
    expect(finished[0]).toMatchObject({ status: 'skipped', skipReason: 'EXTERNAL_REMINDERS_OFF', metrics: { considered: 0 } });
  });

  it('open (listed) and ADA_PARCOURS_EXTERNAL_REMINDERS=on: the run proceeds (both thresholds selected) and is recorded « success »', async () => {
    vi.stubEnv('ADA_CAPABILITY_ENFORCEMENT', '1'); vi.stubEnv('ADA_CAPABILITIES_OPEN', 'citizen.parcours'); vi.stubEnv('ADA_PARCOURS_EXTERNAL_REMINDERS', 'on');
    const handler = (await import('../../api/_handlers/cron/parcours-reminder.js')).default;
    const r = mk();
    await handler({ method: 'GET', url: '/api/cron/parcours-reminder', query: {}, headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.skipped).toBeUndefined();
    expect(dbCalls.length).toBe(2);
    expect(finished[0]).toMatchObject({ status: 'success' });
  });

  it('health-alert: a « skipped » parcours-reminder run is a good run (no LATE while the capability stays closed)', () => {
    expect(WATCHED_JOBS['parcours-reminder'].good).toContain('skipped');
    expect(evaluateJob({ job: 'parcours-reminder', named: true, facts: { runs: 3, lastGoodAgeHours: 20, lastFailedAgeHours: null } }).state).toBe('OK');
  });
});
