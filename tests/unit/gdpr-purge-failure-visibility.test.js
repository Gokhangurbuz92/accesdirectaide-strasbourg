import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A failing retention step must be VISIBLE (logged, Sentry, in the response, non-200) — it used to be swallowed silently.
const m = vi.hoisted(() => ({ deleteCalls: 0, failOn: 3, sentry: vi.fn(), errors: [] }));
vi.mock('@sentry/node', () => ({ captureException: m.sentry, default: { captureException: m.sentry } }));
vi.mock('../../api/_utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: (...a) => m.errors.push(a), debug: vi.fn() } }));
vi.mock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: () => ({ ok: true }) }));
vi.mock('../../src/db/index.js', () => ({
  db: {
    // DTA S8: a drizzle delete().where() is awaitable (node-postgres result with rowCount) AND exposes .returning() (rows). The shared-dossier step now uses .returning() to learn the
    // storage keys of the documents it must erase; both shapes count as ONE delete call, and the assertions below are unchanged.
    delete: () => {
      const step = () => { m.deleteCalls += 1; if (m.deleteCalls === m.failOn) throw new Error('boom'); return { rowCount: 2 }; };
      return {
        where: () => ({
          then: (resolve, reject) => Promise.resolve().then(step).then(resolve, reject),
          returning: async () => { step(); return [{ id: 'a', results: {} }, { id: 'b', results: {} }]; },
        }),
      };
    },
    update: () => ({ set: () => ({ where: async () => ({ rowCount: 1 }) }) }),
  },
}));

import handler from '../../api/_handlers/cron/gdpr-purge.js';
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });

describe('gdpr-purge failure visibility and counts', () => {
  beforeEach(() => { m.deleteCalls = 0; m.failOn = 3; m.sentry.mockClear(); m.errors.length = 0; process.env.GDPR_PURGE_ENABLED = 'true'; });   // R33: the purge runs only when enabled
  afterEach(() => { delete process.env.GDPR_PURGE_ENABLED; });

  it('a failing step => 500 partial_failure, named in failed_steps, logged and sent to Sentry; other steps still ran', async () => {
    const r = res(); await handler({ method: 'GET', query: {}, headers: {}, url: '/x' }, r);
    expect(r.statusCode).toBe(500);
    expect(r.body.status).toBe('partial_failure');
    expect(r.body.failed_steps).toEqual(['deletedAuditCount']);
    expect(m.sentry).toHaveBeenCalledTimes(1);
    expect(m.errors.some((a) => a[0]?.step === 'deletedAuditCount')).toBe(true);
    expect(r.body.tokens_deleted).toBe(2);              // later steps still executed
    expect(r.body.appointments_anonymised).toBe(1);
  });

  it('all steps fine => 200 success with numeric counts from rowCount (node-postgres) and from arrays (.returning)', async () => {
    m.failOn = -1;
    const r = res(); await handler({ method: 'GET', query: {}, headers: {}, url: '/x' }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe('success');
    expect(r.body.failed_steps).toBeUndefined();
    expect(r.body.versions_deleted).toBe(2);
  });
});
