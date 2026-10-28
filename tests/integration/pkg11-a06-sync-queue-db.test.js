/**
 * PKG-11 / A06 — the synchronization queue on REAL PostgreSQL (the ingestion itself is replaced by a stub: no external source is ever contacted):
 *  - a queued run is executed: PENDING → RUNNING → COMPLETE with its real timing and counts (before: « Source not found » forever, counts dropped);
 *  - an old FAILED run whose retry time has passed no longer starves the queue (missing parentheses picked it first);
 *  - a failure is retried later with a growing delay, and is final after five attempts;
 *  - the administrators' run history lists the queue next to the import logs.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const ingest = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../api/_handlers/cron/ingest-structures.js', () => ({ runIngestStructures: (...a) => ingest.fn(...a) }));
vi.mock('../../api/_handlers/cron/ingest-aids.js', () => ({ runIngestAids: vi.fn(async () => ({ created: 0, processed: 0, errors: [] })) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));

const TS = Date.now(); const SRC = `a06-src-${TS}`;
const runs = { stale: `a06-stale-${TS}`, ok: `a06-ok-${TS}`, bad: `a06-bad-${TS}` };

describe('PKG-11 / A06 synchronization queue (real DB)', () => {
  let db; let consume;
  const row = async (id) => (await db.execute(sql`SELECT status, attempts, started_at, ended_at, stats, error, "nextRunAt" AS next FROM "SyncRun" WHERE id = ${id}`)).rows[0];
  const queue = (id, status, opts = {}) => db.execute(sql`INSERT INTO "SyncRun" (id, source_id, status, attempts, "nextRunAt", "createdAt", "updatedAt", started_at)
    VALUES (${id}, ${SRC}, ${status}, ${opts.attempts ?? 0}, ${opts.next ?? null}, ${opts.created ?? new Date()}, NOW(), NOW())`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ consumePendingSyncRuns: consume } = await import('../../api/lib/ingestion/SyncQueueConsumer.js'));
    await db.execute(sql`DELETE FROM "SyncRun" WHERE status = 'PENDING'`);   // this suite owns the queue while it runs
    await db.execute(sql`INSERT INTO "SourceRegistryEntry" (id, source_id, name, type, capabilities, status, failure_count, created_at, updated_at)
      VALUES (${SRC}, ${SRC}, 'A06 synthetic directory', 'CURATED', ARRAY['DIRECTORY']::"SourceCapability"[], 'ACTIVE', 0, NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SyncRun" WHERE source_id = ${SRC}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SourceRegistryEntry" WHERE source_id = ${SRC}`).catch(() => {});
  });

  it('a stale FAILED run does not starve the queue; the queued run completes with its real timing and counts', async () => {
    await queue(runs.stale, 'FAILED', { attempts: 5, next: new Date(Date.now() - 3600000), created: new Date(Date.now() - 7200000) });
    await queue(runs.ok, 'PENDING');
    ingest.fn.mockResolvedValueOnce({ created: 3, processed: 7, updated: 1, errors: [] });
    const out = await consume();
    expect(out).toMatchObject({ ok: true, jobId: runs.ok, status: 'COMPLETE' });
    const r = await row(runs.ok);
    expect(r.status).toBe('COMPLETE');
    expect(r.ended_at).not.toBeNull();
    expect(r.stats).toMatchObject({ addedItems: 3, totalItems: 7, updatedItems: 1, errorCount: 0 });
    expect((await row(runs.stale)).status).toBe('FAILED');   // untouched
    expect(await consume()).toEqual({ ok: true, message: 'No pending jobs' });
  });

  it('a failure is retried later with a growing delay and is final after five attempts', async () => {
    await queue(runs.bad, 'PENDING');
    ingest.fn.mockRejectedValue(new Error('synthetic source unavailable'));
    const first = await consume();
    expect(first).toMatchObject({ ok: false, jobId: runs.bad });
    let r = await row(runs.bad);
    expect([r.status, r.attempts]).toEqual(['PENDING', 1]);
    expect(new Date(r.next).getTime()).toBeGreaterThan(Date.now() + 60000);   // 2 min, then 4, 8 …
    expect(JSON.parse(r.error).message).toBe('synthetic source unavailable');
    expect(await consume(), 'not before its retry time').toEqual({ ok: true, message: 'No pending jobs' });
    await db.execute(sql`UPDATE "SyncRun" SET attempts = 4, "nextRunAt" = NOW() - interval '1 second' WHERE id = ${runs.bad}`);
    await consume();
    r = await row(runs.bad);
    expect([r.status, r.attempts]).toEqual(['FAILED', 5]);
    expect(JSON.parse(r.error)).toEqual({ message: 'synthetic source unavailable', exhausted: true });
    ingest.fn.mockReset();
  });

  it('the run history lists the queue (state, counts, short error) next to the import logs', async () => {
    const { default: handler } = await import('../../api/_handlers/admin/runs.js');
    const auth = await import('../../api/_utils/auth.js');
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
    await handler({ method: 'GET', url: '/api/admin/runs', query: {}, headers: { host: 'localhost', authorization: `Bearer ${auth.signAdminSessionToken({ email: 'a06@example.test', role: 'admin', mfa_verified: false })}` } }, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const mine = Object.fromEntries(res.body.queue.filter((q) => q.sourceId === SRC).map((q) => [q.id, q]));
    expect(mine[runs.ok]).toMatchObject({ status: 'COMPLETE', stats: { addedItems: 3, totalItems: 7 }, error: null });
    expect(mine[runs.bad]).toMatchObject({ status: 'FAILED', attempts: 5, error: 'synthetic source unavailable' });
  });
});
