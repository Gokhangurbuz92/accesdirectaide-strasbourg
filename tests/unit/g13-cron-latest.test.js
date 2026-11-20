/**
 * G13 — GET /api/admin/cron-runs?latest=1: the newest run of EVERY scheduled job (DISTINCT ON job), merged with the scheduled-job list and its beta state.
 * Before, /admin/alertes derived « last run per job » from the newest 101 rows of all jobs together, so weekly or closed jobs vanished. Synthetic data.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ admin: vi.fn(async () => true), execute: vi.fn(), findMany: vi.fn(async () => []) }));
vi.mock('../../api/_utils/auth.js', () => ({ verifyAdmin: h.admin }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: h.execute, query: { CronRun: { findMany: h.findMany, findFirst: vi.fn() } } } }));

import handler from '../../api/_handlers/admin/cron-runs.js';
import { mergeLatestRuns } from '../../api/_services/cron-latest.js';
import { jobStates, SCHEDULED_JOBS } from '../../api/_utils/public-beta.js';

const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_JOBS: 'actualites,health-alert,gdpr-purge', ADA_JOBS_APPROVED: '' };
const ROWS = [   // what DISTINCT ON (job) returns: one row per recorded name
  { id: 'a1', job: 'actualites', status: 'success', trigger: 'cron', skipReason: null, startedAt: new Date('2026-11-19T06:00:00Z'), finishedAt: null, durationMs: 900 },
  { id: 'a0', job: 'ACTUALITES', status: 'failed', trigger: 'cron', skipReason: null, startedAt: new Date('2026-10-01T06:00:00Z'), finishedAt: null, durationMs: 100 },
  { id: 'l1', job: 'link-check', status: 'skipped', trigger: 'cron', skipReason: 'LINK_CHECK_DISABLED', startedAt: '2026-10-04T03:00:00.000Z', finishedAt: null, durationMs: '12' },
  { id: 'v1', job: 'veille-registre', status: 'success', trigger: 'cron', skipReason: null, startedAt: '2026-11-01T00:00:00.000Z', finishedAt: null, durationMs: 5 },
];
const res = () => ({ statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} });

beforeEach(() => { vi.clearAllMocks(); h.admin.mockResolvedValue(true); });

describe('G13 — latest run per scheduled job', () => {
  it('every scheduled job has a row, in order, with its beta state; no run → lastRun null; aliases merged (newest wins); unscheduled names last', () => {
    const out = mergeLatestRuns(ROWS, jobStates(BETA));
    expect(out.filter((j) => j.scheduled).map((j) => j.job)).toEqual(Object.keys(SCHEDULED_JOBS));
    const by = Object.fromEntries(out.map((j) => [j.job, j]));
    expect(by.actualites).toMatchObject({ state: 'OPEN', lastRun: { id: 'a1', status: 'success', startedAt: '2026-11-19T06:00:00.000Z', durationMs: 900 } });
    expect(by['link-check']).toMatchObject({ state: 'CLOSED', lastRun: { status: 'skipped', skipReason: 'LINK_CHECK_DISABLED', durationMs: 12 } });
    expect(by['gdpr-purge']).toMatchObject({ state: 'AWAITING_APPROVAL', approved: false, lastRun: null });
    expect(by['ingest-annuaire']).toMatchObject({ state: 'LEGACY_CLOSED', lastRun: null });
    expect(by['health-alert']).toMatchObject({ state: 'OPEN', lastRun: null });
    expect(out.at(-1)).toMatchObject({ job: 'veille-registre', scheduled: false, state: 'NOT_SCHEDULED' });
    expect(out.find((j) => j.job === 'ACTUALITES')).toBeUndefined();
    // an older alias row never hides a newer run, and a newer alias row wins
    expect(mergeLatestRuns([{ ...ROWS[1], startedAt: '2026-11-20T00:00:00Z' }, ROWS[0]], jobStates(BETA)).find((j) => j.job === 'actualites').lastRun.id).toBe('a0');
    // only what the table needs: no metrics, no error text
    expect(Object.keys(by.actualites.lastRun).sort()).toEqual(['durationMs', 'finishedAt', 'id', 'job', 'skipReason', 'startedAt', 'status', 'trigger']);
  });

  it('outside the beta every job is open; no rows → every scheduled job still listed', () => {
    const out = mergeLatestRuns([], jobStates({}));
    expect(out).toHaveLength(Object.keys(SCHEDULED_JOBS).length);
    expect(new Set(out.map((j) => j.state))).toEqual(new Set(['OPEN_ALL_JOBS']));
    expect(out.every((j) => j.lastRun === null)).toBe(true);
  });

  it('the handler answers { jobs } from one DISTINCT ON (job) query, admin only, GET only', async () => {
    h.execute.mockResolvedValue({ rows: ROWS });
    const r = res();
    await handler({ method: 'GET', url: '/api/admin/cron-runs?latest=1', headers: { host: 'x' }, query: { latest: '1' } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.jobs.length).toBe(Object.keys(SCHEDULED_JOBS).length + 1);
    expect(h.execute).toHaveBeenCalledTimes(1);
    const q = h.execute.mock.calls[0][0];
    const text = (q.queryChunks || []).map((c) => (Array.isArray(c?.value) ? c.value.join('') : '')).join('');
    expect(text).toMatch(/SELECT DISTINCT ON \(job\)/);
    expect(text).toMatch(/ORDER BY job, "startedAt" DESC/);
    expect(text).not.toMatch(/metrics|errorSample/);
    expect(h.findMany).not.toHaveBeenCalled();

    h.admin.mockResolvedValue(false);
    const denied = res();
    await handler({ method: 'GET', url: '/api/admin/cron-runs?latest=1', headers: { host: 'x' }, query: { latest: '1' } }, denied);
    expect(denied.statusCode).toBe(401);
    const post = res();
    await handler({ method: 'POST', url: '/api/admin/cron-runs?latest=1', headers: { host: 'x' }, query: { latest: '1' } }, post);
    expect(post.statusCode).toBe(405);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('without latest=1 the list keeps its former shape ({ items })', async () => {
    h.findMany.mockResolvedValue([{ id: 'x', job: 'actualites' }]);
    const r = res();
    await handler({ method: 'GET', url: '/api/admin/cron-runs?limit=10', headers: { host: 'x' }, query: { limit: '10' } }, r);
    expect(r.body).toEqual({ items: [{ id: 'x', job: 'actualites' }] });
    expect(h.execute).not.toHaveBeenCalled();
  });
});
