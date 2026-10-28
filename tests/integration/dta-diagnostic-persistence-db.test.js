/**
 * N9 (real PostgreSQL) — after /api/diagnostic runs against a real database, scan EVERY public table for unique sentinel values that exist only in the
 * citizen's answers.  Complements tests/unit/dta-diagnostic-privacy-n9.test.js (mocked sinks).  Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 * Status when authored: NOT_RUN (the authoring sandbox cannot start PostgreSQL) — it only counts as evidence after a native run.
 * It proves the database side only; logs/telemetry are covered by the unit test; retention, lawful basis and the privacy notice need human/legal validation.
 */
import { vi } from 'vitest';
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1') }));
vi.mock('../../api/lib/openfiscaClient.js', () => ({ isAvailable: async () => false, calculate: async () => ({}), trace: async () => ({}) }));

import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TAG = `${Date.now().toString(36)}`;
const SENT = { salary: 1234567.891, unemployment: 7654321.123, rent: 8765.432, zip: `SENTINEL-ZIP-${TAG}`, status: `SENTINEL_STATUS_${TAG}`, note: `SENTINEL_FREETEXT_${TAG}` };
const answers = () => ({ birthDate: '1987-04-09', householdSize: 3, income: { salary: SENT.salary, unemployment: SENT.unemployment }, housing: { status: SENT.status, rent: SENT.rent, charges: 12 }, zipCode: SENT.zip, territory: SENT.zip, note: SENT.note });
const FULL = [String(SENT.salary), String(SENT.unemployment), String(SENT.rent), SENT.zip, SENT.status, SENT.note];
const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {}, end() { return this; } });

describe.skipIf(!hasDatabase)('N9 real DB — /api/diagnostic persistence scan', () => {
  let db, handler, tables;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    handler = (await import('../../api/_handlers/diagnostic.js')).default;
    tables = (await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r) => r.tablename);
    expect(tables.length).toBeGreaterThan(10);
  });
  const run = async (body) => { const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x', 'x-forwarded-for': '203.0.113.9' }, socket: {}, body }, r); return r; };
  const scan = async (needles) => {
    const hits = [];
    for (const t of tables) for (const n of needles) {
      const res = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${t}"`)} x WHERE x::text LIKE ${'%' + n + '%'}`);
      if (res.rows[0].n > 0) hits.push(`${t}:${n}`);
    }
    return hits;
  };

  it('SIMULATION_MODE: no table contains any value from the answers', async () => {
    const r = await run({ mode: 'SIMULATION_MODE', answers: answers() });
    expect(r.statusCode).toBe(200);
    expect(await scan(FULL)).toEqual([]);
  });
  it('AUTHORITATIVE_MODE with the engine down (503): no table contains any value from the answers and no result is returned', async () => {
    const r = await run({ answers: answers() });
    expect(r.statusCode).toBe(503);
    expect(r.body.rights).toBeUndefined();
    expect(await scan(FULL)).toEqual([]);
  });
  it('validation failure (400): nothing stored', async () => {
    const bad = answers(); bad.income.salary = -1;
    expect((await run({ mode: 'SIMULATION_MODE', answers: bad })).statusCode).toBe(400);
    expect(await scan(FULL)).toEqual([]);
  });
  it('REGRESSION (stage 2a): an unparsable string body (V8 quotes a ~10-char window of it) leaves NO fragment in any table, SyncRun.error included', async () => {
    const r = await run(`{"answers":{"housing":{"status":${SENT.status},"rent":${SENT.rent}},"note":"x"}}`);
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('invalid_json');
    const hits = await scan(['SENTINEL_S']);
    console.log('N9 real-DB (unparsable body) tables containing a fragment:', hits.length ? hits.join(', ') : 'none');
    expect(hits).toEqual([]);
    const err = (await db.execute(sql`SELECT error FROM "SyncRun" WHERE source_id = 'openfisca-diagnostic' ORDER BY started_at DESC LIMIT 1`)).rows[0];
    console.log('N9 real-DB latest SyncRun.error value:', err && err.error);
    expect(err && err.error).toBe('INVALID_JSON');                                     // observability kept: closed-vocabulary code only
  });
  it('the only table that gains rows is SyncRun (metadata)', async () => {
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${t}"`)}`)).rows[0].n])));
    const before = await counts();
    await run({ mode: 'SIMULATION_MODE', answers: answers() });
    const after = await counts();
    const changed = Object.keys(after).filter((t) => after[t] !== before[t]);
    expect(changed.every((t) => t === 'SyncRun')).toBe(true);
  });
});
