/**
 * Y2 — the hourly health check prunes the Upstash erasure traces older than 40 days even when no erasure happens (privacy notice § 4 « 40 jours »).
 * REAL PostgreSQL (run records), in-memory KV stand-in with lists. Skipped without DATABASE_URL.
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn(), default: { captureException: vi.fn(), captureMessage: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map(), failList: false }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  isRemote: true, incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
  lpush: async (k, v) => { const l = kvState.store.get(k) || []; l.unshift(v); kvState.store.set(k, l); return l.length; },
  lrange: async (k, a, b) => { if (kvState.failList) throw new Error('synthetic'); const l = kvState.store.get(k) || []; return l.slice(a, b < 0 ? l.length + b + 1 : b + 1); },
  ltrim: async (k, a, b) => { const l = kvState.store.get(k) || []; kvState.store.set(k, l.slice(a, b < 0 ? l.length + b + 1 : b + 1)); return 'OK'; },
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('Y2: the hourly health check expires erasure traces entry by entry (real DB)', () => {
  let db, handler, T; const saved = {};
  const check = async () => { const r = mk(); await handler({ method: 'GET', url: '/api/cron/health-alert', query: {}, headers: { host: 'x', authorization: `Bearer ${process.env.CRON_SECRET}` } }, r); return r.body; };
  const wipe = () => db.execute(sql`DELETE FROM "CronRun" WHERE job = 'health-alert'`);
  beforeAll(async () => {
    for (const k of ['ALERT_WEBHOOK_URL', 'ALERT_EMAIL']) { saved[k] = process.env[k]; delete process.env[k]; }
    ({ db } = await import('../../src/db/index.js'));
    ({ default: handler } = await import('../../api/_handlers/cron/health-alert.js'));
    T = await import('../../api/_services/erasure-tombstones.js');
    await wipe();
  });
  afterAll(async () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } if (db) await wipe(); });

  it('old entries go, young ones stay, an old marker loses its request id; a failure is reported', async () => {
    const { kv } = await import('../../api/_utils/kv.js');
    const t = T.createErasureTombstones({ kv, requireRemote: true, copy: null });
    const old = { requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account'], at: new Date(Date.now() - 41 * 86400000) };
    // written as if 41 days ago, with the write-time prune bypassed (a list left by the former code)
    kvState.store.set(T.TOMBSTONE_KEY, [JSON.stringify(T.tombstoneOf(old, 'done')), JSON.stringify(T.tombstoneOf({ ...old, requestId: crypto.randomUUID() }, 'intent'))]);
    kvState.store.set(T.TOMBSTONE_LAST_KEY, JSON.stringify({ requestId: old.requestId, phase: 'done', completedAt: old.at.toISOString() }));
    const out = await check();
    expect(out.checks.tombstoneRetention).toEqual({ ok: true, removed: 2, kept: 0, markerScrubbed: true });
    expect(kvState.store.get(T.TOMBSTONE_KEY)).toEqual([]);
    expect(JSON.parse(kvState.store.get(T.TOMBSTONE_LAST_KEY)).requestId).toBe(null);
    await t.record({ requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account'] });
    expect((await check()).checks.tombstoneRetention).toEqual({ ok: true, removed: 0, kept: 1 });
    kvState.failList = true;
    try {
      const bad = await check();
      expect(bad.checks.tombstoneRetention).toEqual({ ok: false, error: 'Error' });
      expect([...kvState.store.keys()]).toContain('alert:cooldown:tombstones.retention_failed');
    } finally { kvState.failList = false; }
  });
});
