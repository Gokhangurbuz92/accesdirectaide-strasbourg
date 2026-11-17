/**
 * C5 (owner Paket 4: Upstash Free, no paid plan) — the hourly health check notices that the KV store LOST its data (archived after idleness and recreated,
 * flushed, replaced by a new empty database), not only that it is unreachable. REAL PostgreSQL (the run records), in-memory KV stand-in.
 *   1  first run ever: the sentinel is written, its time is copied into the run record, no alert;
 *   2  the store keeps its data: green, no alert;
 *   3  the store is emptied: « kv.data_lost » once, the sentinel is written again, the next run is green and does not repeat the alert;
 *   4  the store is unreachable: « kv.down » as before, the data check is skipped (never a false « lost »).
 * Skipped without DATABASE_URL.
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn(), default: { captureException: vi.fn(), captureMessage: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map(), down: false }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => { if (kvState.down && !k.startsWith('alert:')) throw new Error('synthetic KV outage'); return kvState.store.get(k) ?? null; },
  set: async (k, v, o) => { if (kvState.down && !k.startsWith('alert:')) throw new Error('synthetic KV outage'); if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('C5: the health check detects a KV store that lost its data (real DB)', () => {
  let db, handler, SENTINEL; const saved = {};
  const ENV = ['ALERT_WEBHOOK_URL', 'ALERT_EMAIL'];
  const check = async () => { const r = mk(); await handler({ method: 'GET', url: '/api/cron/health-alert', query: {}, headers: { host: 'x', authorization: `Bearer ${process.env.CRON_SECRET}` } }, r); return r.body; };
  const cooldowns = () => [...kvState.store.keys()].filter((k) => k.startsWith('alert:cooldown:kv.')).map((k) => k.slice('alert:cooldown:'.length));
  const lastRecord = async () => (await db.execute(sql`SELECT metrics FROM "CronRun" WHERE job = 'health-alert' AND status <> 'running' ORDER BY "startedAt" DESC LIMIT 1`)).rows[0];
  const wipe = () => db.execute(sql`DELETE FROM "CronRun" WHERE job = 'health-alert'`);

  beforeAll(async () => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    ({ db } = await import('../../src/db/index.js'));
    ({ default: handler, KV_SENTINEL_KEY: SENTINEL } = await import('../../api/_handlers/cron/health-alert.js'));
    await wipe();
  });
  afterAll(async () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } if (db) await wipe(); });

  it('1–3 first write, kept data, then an emptied store: ONE « kv.data_lost », the sentinel comes back, no repeat', async () => {
    const first = await check();
    expect(first.checks.kvData).toMatchObject({ ok: true, firstWrite: true }); expect(cooldowns()).toEqual([]);
    const since = kvState.store.get(SENTINEL); expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await lastRecord()).metrics.kvSentinelSince).toBe(since);

    const kept = await check();
    expect(kept.checks.kvData).toEqual({ ok: true, since }); expect(cooldowns()).toEqual([]);

    kvState.store.clear();   // Upstash Free archived the idle database and a new empty one answers (or it was flushed)
    const lost = await check();
    expect(lost.checks.kvData).toEqual({ ok: false, lostSince: since }); expect(lost.ok).toBe(false);
    expect(cooldowns()).toEqual(['kv.data_lost']);
    const again = kvState.store.get(SENTINEL); expect(again).toBeTruthy(); expect(again).not.toBe(since);
    expect((await lastRecord()).metrics.kvSentinelSince).toBe(again);

    kvState.store.delete('alert:cooldown:kv.data_lost');   // even without the cooldown, the next check does not repeat the alert: the sentinel is back
    const next = await check();
    expect(next.checks.kvData).toEqual({ ok: true, since: again }); expect(cooldowns()).toEqual([]);
  });

  it('4 an unreachable store is « kv.down », and the data check is skipped (never a false « lost »)', async () => {
    kvState.down = true;
    try {
      const out = await check();
      expect(out.checks.kv.ok).toBe(false); expect(out.checks.kvData).toEqual({ ok: true, skipped: 'KV_UNREACHABLE' });
      expect(cooldowns()).toEqual(['kv.down']);
    } finally { kvState.down = false; }
  });
});
