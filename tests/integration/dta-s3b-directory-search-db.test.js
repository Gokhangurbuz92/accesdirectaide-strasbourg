/**
 * DTA S3B — keyword (`q`) search of the public directory on REAL PostgreSQL with the MIGRATED schema.
 * Native run 2c3060: GET /api/structures?q=CAF answered 500 (`column "search_vector" does not exist`): no migration creates `search_vector`, and PostgreSQL resolves a column at parse time even inside
 * a CASE branch, so the old runtime guards could not help.  This test is the contract: the handler answers 200 with the real response shape, finds a structure by NAME (accent-insensitive input is accepted),
 * never returns a non-matching one, and `hasSearchVector` agrees with the catalogue.  Synthetic rows only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const IDS = { caf: `s3b-caf-${TS}`, other: `s3b-oth-${TS}`, inactive: `s3b-ina-${TS}` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end() { return this; } });

describe.skipIf(!hasDatabase)('GET /api/structures?q= on the migrated schema (real DB)', () => {
  let db, handler, searchQuery;
  const get = async (query) => { const r = mk(); await handler({ method: 'GET', url: '/api/structures', headers: { host: 'localhost' }, query }, r); return r; };
  const ins = (id, nom, statut) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${id}, ${nom}, ${'slug-' + id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, NOW(), NOW())`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); searchQuery = await import('../../api/lib/search-query.js'); ({ default: handler } = await import('../../api/_handlers/structures.js'));
    searchQuery.resetSearchVectorCache();
    await ins(IDS.caf, `CAF QA Synthétique ${TS}`, 'actif'); await ins(IDS.other, `Association QA Quelconque ${TS}`, 'actif'); await ins(IDS.inactive, `CAF QA Inactive ${TS}`, 'inactif');
  });
  afterAll(async () => { if (db) for (const id of Object.values(IDS)) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`); });

  it('the exact request the plan makes (q, limit, sort) answers 200 with { items, pagination } and finds the structure by name', async () => {
    const r = await get({ q: 'CAF', limit: '20', sort: 'relevance' });
    expect(r.statusCode, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true); expect(r.body.pagination).toBeTruthy();
    const mine = r.body.items.find((s) => s.id === IDS.caf);
    expect(mine, 'the CAF-named synthetic structure is returned').toBeTruthy();
    expect(mine.slug).toBe('slug-' + IDS.caf); expect(mine.nom).toContain('CAF QA'); expect(mine.ville).toBe('Strasbourg');
  });
  it('never returns a non-matching or inactive structure', async () => {
    const r = await get({ q: 'CAF QA Synth', limit: '50' }); expect(r.statusCode).toBe(200);
    const ids = r.body.items.map((s) => s.id); expect(ids).toContain(IDS.caf); expect(ids).not.toContain(IDS.other); expect(ids).not.toContain(IDS.inactive);
  });
  it('an accented / mixed-case query is accepted and answers 200 (no SQL error)', async () => {
    for (const q of ['Synthétique', 'synthetique', 'caf', "l'Association"]) { const r = await get({ q }); expect(r.statusCode, q).toBe(200); }
  });
  it('without q the listing still answers 200', async () => { expect((await get({ limit: '5' })).statusCode).toBe(200); });
  it('the same defect existed for the citizen\'s aide and démarche keyword searches: they answer without a SQL error on the migrated schema (rank and where clauses)', async () => {
    for (const q of ['allocation', 'logement', 'Café']) {
      const aides = await searchQuery.searchAides({ q, page: 1, pageSize: 5, sort: 'pertinence' }); expect(Array.isArray(aides.items), 'aides ' + q).toBe(true); expect(typeof aides.total).toBe('number');
      const dem = await searchQuery.searchDemarches({ q, page: 1, pageSize: 5, sort: 'pertinence' }); expect(Array.isArray(dem.items), 'demarches ' + q).toBe(true); expect(typeof dem.total).toBe('number');
    }
  });
  it('hasSearchVector agrees with the catalogue and is stable', async () => {
    const res = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Structure' AND column_name = 'search_vector') AS col, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') AS ext`);
    const row = (res.rows || res)[0]; expect(await searchQuery.hasSearchVector('Structure')).toBe(Boolean(row.col && row.ext)); expect(await searchQuery.hasSearchVector('Structure')).toBe(Boolean(row.col && row.ext));
  });
});
