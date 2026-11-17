/**
 * RA-06 on REAL PostgreSQL — GET /api/admin/link-checks as the administrator page « Liens officiels » reads it: `kind=link` keeps the results of the link
 * check only (the automatic verification keeps its own snapshots in the same table), each check carries the address that was checked, `is_broken` keeps the
 * failures; without `kind` the answer keeps its former shape. Administrator session required. Synthetic data; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `ra06${Date.now().toString(36)}`;
const U = (p) => `https://www.service-public.fr/${TS}/${p}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, on() { return this; } });

describe.skipIf(!hasDatabase)('RA-06 — the link checks an administrator reads (real DB)', () => {
  let db, auth, handler;
  const snap = (entityId, excerpt, status, finalUrl, minutesAgo) => db.execute(sql`INSERT INTO "SourceSnapshot" (id, entity_type, entity_id, fetched_at, raw_excerpt, http_status, final_url, "createdAt")
    VALUES (gen_random_uuid()::text, 'Aide', ${entityId}, NOW() + interval '1 day' - make_interval(mins => ${minutesAgo}), ${excerpt}, ${status}, ${finalUrl}, NOW())`);   // dated ahead: the newest rows of the table, whatever else it holds
  const get = async (query, token = true) => {
    const r = mk();
    await handler({ method: 'GET', url: '/api/admin/link-checks', query, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${auth.signAdminSessionToken({ email: `${TS}@example.test`, role: 'admin', mfa_verified: false })}` } : {}) } }, r);
    return r;
  };
  const mine = (body) => body.items.filter((i) => i.entity_id.startsWith(TS));

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); handler = (await import('../../api/_handlers/admin/link-checks.js')).default;
    await snap(`${TS}-a`, `link:${U('gone')}`, 404, U('gone'), 1);
    await snap(`${TS}-a`, `link:${U('ok')}`, 200, U('ok'), 2);
    await snap(`${TS}-b`, `link:${U('moved')}`, 200, U('new'), 3);
    await snap(`${TS}-b`, `link:${U('down')}`, 0, U('down'), 4);
    await snap(`${TS}-c`, JSON.stringify({ title: 'instantané de la veille' }), 500, U('veille'), 5);   // not a link check
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "SourceSnapshot" WHERE entity_id LIKE ${`${TS}%`}`).catch(() => {}); });

  it('kind=link: only link checks, each with the address checked, newest first', async () => {
    const out = await get({ kind: 'link', limit: '100' });
    expect(out.statusCode).toBe(200);
    const items = mine(out.body);
    expect(items.map((i) => i.entity_id)).toEqual([`${TS}-a`, `${TS}-b`]);
    expect(items[0]).toMatchObject({ entity_type: 'Aide', checks: [{ http_status: 404, url: U('gone'), final_url: U('gone') }, { http_status: 200, url: U('ok') }] });
    expect(items[1].checks.map((c) => [c.url, c.http_status, c.final_url])).toEqual([[U('moved'), 200, U('new')], [U('down'), 0, U('down')]]);
    expect(items[0].checks[0].fetched_at).toBeTruthy();
  });

  it('kind=link with is_broken=true: the failures of the link check only (not another failing snapshot)', async () => {
    const items = mine((await get({ kind: 'link', is_broken: 'true', limit: '100' })).body);
    expect(items.flatMap((i) => i.checks.map((c) => [i.entity_id, c.url, c.http_status]))).toEqual([[`${TS}-a`, U('gone'), 404], [`${TS}-b`, U('down'), 0]]);
  });

  it('without kind the former answer is kept (every snapshot; url is null for a snapshot that is not a link check)', async () => {
    const items = mine((await get({ is_broken: 'true', limit: '100' })).body);
    expect(items.map((i) => i.entity_id)).toEqual([`${TS}-a`, `${TS}-b`, `${TS}-c`]);
    expect(items[2].checks).toEqual([expect.objectContaining({ http_status: 500, final_url: U('veille'), url: null })]);
  });

  it('refuses a request without an administrator session, and any method but GET', async () => {
    expect((await get({ kind: 'link' }, false)).statusCode).toBe(401);
    const r = mk(); await handler({ method: 'POST', url: '/api/admin/link-checks', query: {}, headers: { host: 'localhost', authorization: `Bearer ${auth.signAdminSessionToken({ email: `${TS}@example.test`, role: 'admin', mfa_verified: true })}` } }, r);
    expect(r.statusCode).toBe(405);
  });
});
