/**
 * D5 b — the hourly health check watches the second copy of the erasure tombstones (check 2c). REAL PostgreSQL (run records), in-memory KV stand-in,
 * local fake S3 bucket (loopback).
 *   1  no variables: skipped (today's behaviour), no alert;
 *   2  incomplete variables: « tombstone_copy.config_invalid »;
 *   3  configured and reachable: green; records older than 40 days are deleted;
 *   4  a write failed since the last check (marker set by the erasure): « tombstone_copy.write_failed » once, marker cleared;
 *   5  bucket refuses the token / unreachable: « tombstone_copy.unreachable ».
 * Skipped without DATABASE_URL.
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { startFakeS3 } from '../helpers/fake-s3.mjs';

const hasDatabase = !!process.env.DATABASE_URL;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const BUCKET = 'ada-erasure-tombstones';
const VARS = ['TOMBSTONE_COPY_S3_ENDPOINT', 'TOMBSTONE_COPY_S3_BUCKET', 'TOMBSTONE_COPY_S3_ACCESS_KEY_ID', 'TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY', 'TOMBSTONE_COPY_KEY', 'ALERT_WEBHOOK_URL', 'ALERT_EMAIL'];

describe.skipIf(!hasDatabase)('D5 b: the health check watches the second tombstone copy (real DB, fake bucket)', () => {
  let db, handler, s3, copyMod, tombMod; const saved = {};
  const check = async () => { const r = mk(); await handler({ method: 'GET', url: '/api/cron/health-alert', query: {}, headers: { host: 'x', authorization: `Bearer ${process.env.CRON_SECRET}` } }, r); return r.body; };
  const cooldowns = () => [...kvState.store.keys()].filter((k) => k.startsWith('alert:cooldown:tombstone_copy.')).map((k) => k.slice('alert:cooldown:'.length)).sort();
  const setEnv = (o) => { for (const k of VARS.slice(0, 5)) delete process.env[k]; Object.assign(process.env, o); };
  const fullEnv = (key = 'tombkey') => ({ TOMBSTONE_COPY_S3_ENDPOINT: s3.endpoint, TOMBSTONE_COPY_S3_BUCKET: BUCKET, TOMBSTONE_COPY_S3_ACCESS_KEY_ID: key,
    TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY: 'fake-secret', TOMBSTONE_COPY_KEY: 'ab'.repeat(32) });
  const wipe = () => db.execute(sql`DELETE FROM "CronRun" WHERE job = 'health-alert'`);

  beforeAll(async () => {
    for (const k of VARS) { saved[k] = process.env[k]; delete process.env[k]; }
    s3 = await startFakeS3({ bucket: BUCKET, keys: { tombkey: { write: true } } });
    ({ db } = await import('../../src/db/index.js'));
    ({ default: handler } = await import('../../api/_handlers/cron/health-alert.js'));
    copyMod = await import('../../api/_services/erasure-tombstone-copy.js'); tombMod = await import('../../api/_services/erasure-tombstones.js');
    await wipe();
  });
  afterAll(async () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } await s3?.close(); if (db) await wipe(); });

  it('1 off without variables; 2 incomplete variables alert', async () => {
    setEnv({});
    expect((await check()).checks.tombstoneCopy).toEqual({ ok: true, skipped: 'COPY_OFF' });
    setEnv({ TOMBSTONE_COPY_S3_BUCKET: BUCKET });
    const out = await check();
    expect(out.checks.tombstoneCopy).toMatchObject({ ok: false, reason: 'COPY_CONFIG_INCOMPLETE' });
    expect(cooldowns()).toEqual(['tombstone_copy.config_invalid']);
  });

  it('3 reachable: green, overdue records deleted; 4 a failed write alerts once and the marker is cleared', async () => {
    setEnv(fullEnv());
    const copy = copyMod.createTombstoneCopy(copyMod.copyConfig(process.env));
    const t = tombMod.createErasureTombstones({ kv: { isRemote: true, async lpush() {}, async ltrim() {}, async expire() {}, async set() {}, async get() { return null; }, async lrange() { return []; } }, requireRemote: true, copy, log: { error() {}, warn() {} } });
    await t.record({ requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account'], at: new Date(Date.now() - 41 * 86400000) });
    await t.record({ requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account'] });
    const green = await check();
    expect(green.checks.tombstoneCopy).toEqual({ ok: true, objects: 1, overdueDeleted: 1, deleteFailed: 0, truncated: false });

    kvState.store.set(tombMod.TOMBSTONE_COPY_FAILED_KEY, JSON.stringify({ at: '2026-11-17T10:00:00.000Z', phase: 'intent' }));
    const failed = await check();
    expect(failed.checks.tombstoneCopy).toMatchObject({ ok: false, lastWriteFailure: '2026-11-17T10:00:00.000Z' });
    expect(cooldowns()).toContain('tombstone_copy.write_failed');
    expect(kvState.store.has(tombMod.TOMBSTONE_COPY_FAILED_KEY)).toBe(false);
    expect((await check()).checks.tombstoneCopy.ok).toBe(true);
  });

  it('5 a token the bucket refuses: « tombstone_copy.unreachable »', async () => {
    setEnv(fullEnv('unknown-key'));
    const out = await check();
    expect(out.checks.tombstoneCopy).toMatchObject({ ok: false, status: 403 });
    expect(cooldowns()).toContain('tombstone_copy.unreachable');
  });
});
