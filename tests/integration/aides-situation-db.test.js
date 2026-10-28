/**
 * Life-situation filter — real PostgreSQL through the real /api/aides handler and search-query.
 * Contract: GET /api/aides?situation=<Situation.code | LifeSituation.slug> returns only linked, published aids.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { vi } from 'vitest';
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SIT_CODE = `sit-code-${TS}`;
const LIFE_SLUG = `life-slug-${TS}`;
const A = { id: `sitdb-a-${TS}`, slug: `sitdb-a-${TS}` };
const B = { id: `sitdb-b-${TS}`, slug: `sitdb-b-${TS}` };
const L = { id: `sitdb-l-${TS}`, slug: `sitdb-l-${TS}` };

describe.skipIf(!hasDatabase)('aides ?situation= filter (real DB)', () => {
  let handler, db, schema;
  const list = async (query) => {
    const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c) { this.statusCode = c; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } };
    await handler({ method: 'GET', url: '/api/aides', query: { statut: 'publie', pageSize: '50', ...query }, headers: { host: 'localhost:3000' } }, res);
    return res;
  };

  beforeAll(async () => {
    ({ default: handler } = await import('../../api/_handlers/aides.js'));
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    await db.insert(schema.Aide).values([
      { id: A.id, slug: A.slug, titre: `Aide A situation ${TS}`, statut: 'publie' },
      { id: B.id, slug: B.slug, titre: `Aide B sans situation ${TS}`, statut: 'publie' },
      { id: L.id, slug: L.slug, titre: `Aide L situation legacy ${TS}`, statut: 'publie' },
    ]);
    const [sit] = await db.insert(schema.Situation).values({ code: SIT_CODE, label: 'Situation test' }).returning();
    await db.insert(schema.AidSituation).values({ aidId: A.id, situationId: sit.id });
    const [life] = await db.insert(schema.LifeSituation).values({ slug: LIFE_SLUG, label: 'Legacy test' }).returning();
    await db.insert(schema.AideToLifeSituation).values({ LifeSituationId: life.id, AideId: L.id });
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AidSituation" WHERE "aidId" IN (${A.id}, ${B.id}, ${L.id})`);
    await db.execute(sql`DELETE FROM "_AideToLifeSituation" WHERE "A" IN (${A.id}, ${B.id}, ${L.id})`);
    await db.execute(sql`DELETE FROM "Situation" WHERE code = ${SIT_CODE}`);
    await db.execute(sql`DELETE FROM "LifeSituation" WHERE slug = ${LIFE_SLUG}`);
    await db.execute(sql`DELETE FROM "Aide" WHERE id IN (${A.id}, ${B.id}, ${L.id})`);
  });

  it('Situation.code filter returns only the linked aid', async () => {
    const res = await list({ situation: SIT_CODE });
    expect(res.statusCode).toBe(200);
    expect(res.body.items.map((i) => i.slug)).toEqual([A.slug]);
  });

  it('legacy LifeSituation.slug filter returns only the legacy-linked aid', async () => {
    const res = await list({ situation: LIFE_SLUG });
    expect(res.statusCode).toBe(200);
    expect(res.body.items.map((i) => i.slug)).toEqual([L.slug]);
  });

  it('unknown situation yields an empty (not a 5xx) result and no filter returns the unlinked aids too', async () => {
    const none = await list({ situation: `nope-${TS}` });
    expect(none.statusCode).toBe(200);
    expect(none.body.items).toHaveLength(0);
    const all = await list({ q: `${TS}` });
    expect(all.statusCode).toBe(200);
    expect(all.body.items.map((i) => i.slug).sort()).toEqual([A.slug, B.slug, L.slug].sort());
  });

  it('SQL metacharacters in situation are treated as data', async () => {
    const res = await list({ situation: `x' OR '1'='1` });
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});
