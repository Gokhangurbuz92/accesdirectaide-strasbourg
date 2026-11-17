/**
 * C2 (owner Paket 4, RB-01: LAB first; only allow-listed sources, quota + timeout, never publishes or deletes) — REAL PostgreSQL, STUBBED network: nothing
 * leaves the machine and no Production route is called.
 *   Q  per-run quota: no new address once `maxRequests` HTTP requests were made; the next run takes the addresses never checked first (fairness);
 *   T  total time budget: no new address after `budgetMs` (injected clock); per-request timeout passed to every request;
 *   R  report only: two consecutive 404 open ONE review item; the records themselves (status, verification, visibility) are byte-identical afterwards;
 *   H  the cron handler: off → a « skipped » run record and no request; on → bounded by LINK_CHECK_MAX_REQUESTS, run record « partial » when it stopped early.
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const U = (i) => `https://www.service-public.fr/c2-${TS}/page-${i}`;
const N = 6;
const mine = (u) => String(u).includes(`c2-${TS}`);

describe.skipIf(!hasDatabase)('C2 link check: quota, time budget, report only (real DB, stubbed network)', () => {
  let db, run, handler; const calls = [];
  const stub = async (url, init = {}) => { calls.push({ url: String(url), method: init.method, hasSignal: Boolean(init.signal) }); return { status: String(url).endsWith('page-0') ? 404 : 200, headers: { get: () => null } }; };
  const ids = Array.from({ length: N }, (_, i) => `c2-a${i}-${TS}`);
  const records = async () => JSON.stringify((await db.execute(sql`SELECT id, statut, verification_status, launch_eligible, verified_by, territory_verified, date_verification, source_url FROM "Aide" WHERE id LIKE ${`c2-%-${TS}`} ORDER BY id`)).rows);
  const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const runs = async () => (await db.execute(sql`SELECT status, "skipReason", metrics FROM "CronRun" WHERE job = 'link-check' ORDER BY "startedAt" DESC LIMIT 1`)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ runLinkCheck: run } = await import('../../api/_services/link-check.js'));
    handler = (await import('../../api/_handlers/cron/link-check.js')).default;
    for (const [i, id] of ids.entries()) await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
      VALUES (${id}, ${id}, ${'Aide ' + id}, 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '5 days', 'official', ${U(i)}, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    delete process.env.LINK_CHECK_ENABLED; delete process.env.LINK_CHECK_MAX_REQUESTS;
    await db.execute(sql`DELETE FROM "ReviewQueueItem" WHERE "entityId" LIKE ${`c2-%-${TS}`}`);
    await db.execute(sql`DELETE FROM "SourceSnapshot" WHERE entity_id LIKE ${`c2-%-${TS}`}`);
    await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`c2-%-${TS}`}`);
  });

  it('Q quota: at most maxRequests requests per run; the next run checks the addresses never checked first; every request carries a timeout signal', async () => {
    // only this suite's addresses are visible in a fresh LAB database; others (if any) only make the quota bind sooner
    const first = await run({ db, fetchImpl: stub, spacingMs: 0, maxRequests: 3 });
    expect(first.requests).toBeLessThanOrEqual(3); expect(first.stoppedEarly).toBe(true); expect(first.skippedQuota).toBeGreaterThanOrEqual(1);
    const firstMine = calls.filter((c) => mine(c.url)).map((c) => c.url);
    expect(calls.every((c) => c.hasSignal)).toBe(true);
    calls.length = 0;
    const second = await run({ db, fetchImpl: stub, spacingMs: 0, maxRequests: 3 });
    expect(second.requests).toBeLessThanOrEqual(3);
    const secondMine = calls.filter((c) => mine(c.url)).map((c) => c.url);
    expect(secondMine.filter((u) => firstMine.includes(u)), 'the second run starts with the addresses the first did not reach').toEqual([]);
    calls.length = 0;
  });

  it('T time budget: no new address once the budget is spent (injected clock)', async () => {
    let t = 0; const clock = () => (t += 100);   // every reading of the clock advances 100 ms
    const out = await run({ db, fetchImpl: stub, spacingMs: 0, budgetMs: 250, clock });
    expect(out.skippedTimeBudget).toBeGreaterThanOrEqual(1); expect(out.stoppedEarly).toBe(true);
    expect(out.requests).toBeLessThan(N);
    calls.length = 0;
  });

  it('R report only: two consecutive 404 open ONE review item; the records are unchanged (nothing published, withdrawn or deleted)', async () => {
    const before = await records();
    for (let i = 0; i < 3; i += 1) await run({ db, fetchImpl: stub, spacingMs: 0 });
    expect(await records()).toBe(before);
    const items = (await db.execute(sql`SELECT reason, status, details FROM "ReviewQueueItem" WHERE "entityId" = ${ids[0]}`)).rows;
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ reason: 'SOURCE_LINK_BROKEN', status: 'OPEN' }); expect(items[0].details.url).toBe(U(0));
    calls.length = 0;
  });

  it('H handler: off → « skipped » run record and no request; on → bounded by LINK_CHECK_MAX_REQUESTS, « partial » when stopped early', async () => {
    const req = { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} };
    delete process.env.LINK_CHECK_ENABLED;
    let res = mk(); await handler(req, res, { fetchImpl: stub, spacingMs: 0 });
    expect(res.body.skipped).toBe('disabled'); expect(calls).toHaveLength(0);
    expect(await runs()).toMatchObject({ status: 'skipped', skipReason: 'LINK_CHECK_DISABLED' });
    process.env.LINK_CHECK_ENABLED = '1'; process.env.LINK_CHECK_MAX_REQUESTS = '2';
    res = mk(); await handler(req, res, { fetchImpl: stub, spacingMs: 0 });
    expect(res.statusCode).toBe(200); expect(res.body.requests).toBeLessThanOrEqual(2); expect(calls.length).toBeLessThanOrEqual(2);
    const r = await runs(); expect(r.status).toBe('partial'); expect(r.metrics).toMatchObject({ maxRequests: 2, budgetMs: 200000, stoppedEarly: true });
    expect(JSON.stringify(r.metrics)).not.toMatch(/https?:|c2-/);   // counts only in the run record
    process.env.LINK_CHECK_MAX_REQUESTS = '999999';   // a value above the cap is capped, never obeyed
    res = mk(); await handler(req, res, { fetchImpl: stub, spacingMs: 0 });
    expect((await runs()).metrics.maxRequests).toBe(1000);
    // no credential: an unauthenticated call is refused before anything runs
    const anon = mk(); await handler({ method: 'GET', headers: {}, query: {} }, anon, { fetchImpl: stub }); expect(anon.statusCode).toBe(401);
  });
});
