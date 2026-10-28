/**
 * DTA S4A — GET /api/structures?slug= | ?id= (the structure page and the booking entry read this) on REAL PostgreSQL with the MIGRATED schema.
 * Native run 436e5e: every single-structure read answered 404 "Structure non trouvée" because the handler asked Drizzle for a relation (`proServices`) that does not exist on Structure
 * (the relations are `proRdvServices` and `rdvSettings`, the latter `many`); Drizzle threw before any SQL and a catch-all turned it into a 404, so mocks and logs stayed silent.
 * Contract asserted here with real rows: 200 + the structure, rdv flag from StructureRdvSettings (array relation), only ACTIVE services with the public columns,
 * no internal/contact settings leaked, services hidden when the RDV is not published, 404 only for a really unknown or inactive structure.  Synthetic rows; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ID = { pub: `s4a-pub-${TS}`, unpub: `s4a-unp-${TS}`, legacy: `s4a-leg-${TS}`, inactive: `s4a-ina-${TS}` };
const SVC = { on: `s4a-svc-on-${TS}`, off: `s4a-svc-off-${TS}`, hidden: `s4a-svc-hid-${TS}` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end() { return this; } });

describe.skipIf(!hasDatabase)('GET /api/structures?slug|id on the migrated schema (real DB)', () => {
  let db, handler;
  const get = async (query) => { const r = mk(); await handler({ method: 'GET', url: '/api/structures', headers: { host: 'localhost' }, query }, r); return r; };
  const ins = (id, nom, statut, pro) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, is_pro_enabled, "updatedAt", "createdAt") VALUES (${id}, ${nom}, ${'slug-' + id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${pro}, NOW(), NOW())`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); ({ default: handler } = await import('../../api/_handlers/structures.js'));
    await ins(ID.pub, 'S4A Publiée', 'actif', true); await ins(ID.unpub, 'S4A Non publiée', 'actif', false); await ins(ID.legacy, 'S4A Legacy', 'actif', true); await ins(ID.inactive, 'S4A Inactive', 'inactif', true);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "contactEmail", "contactPhone", "updatedAt", "createdAt") VALUES (${'s4a-set-pub-' + TS}, ${ID.pub}, true, 'IN_PERSON', 'internal-contact@example.test', '+33000000000', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt", "createdAt") VALUES (${'s4a-set-unp-' + TS}, ${ID.unpub}, false, 'IN_PERSON', NOW(), NOW())`);
    for (const [k, sid, active] of [['on', ID.pub, true], ['off', ID.pub, false], ['hidden', ID.unpub, true]]) {
      await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "isActive", "updatedAt", "createdAt") VALUES (${SVC[k]}, ${sid}, ${'Service ' + k}, 30, ${active}, NOW(), NOW())`);
    }
  });
  afterAll(async () => {
    if (!db) return;
    for (const id of Object.values(SVC)) await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${id}`);
    for (const id of Object.values(ID)) { await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${id}`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`); }
  });

  it('slug read: 200 with the structure, the published RDV flag and ONLY the active service with public columns', async () => {
    const r = await get({ slug: 'slug-' + ID.pub });
    expect(r.statusCode, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.id).toBe(ID.pub); expect(r.body.nom).toBe('S4A Publiée');
    expect(r.body.rdv).toEqual({ isPublished: true, bookingMode: 'IN_PERSON' }); expect(r.body.is_pro_enabled).toBe(true);
    expect(r.body.proServices).toEqual([{ id: SVC.on, name: 'Service on', durationMinutes: 30 }]);
  });
  it('id read gives the same structure', async () => {
    const r = await get({ id: ID.pub }); expect(r.statusCode).toBe(200); expect(r.body.slug).toBe('slug-' + ID.pub);
  });
  it('nothing internal leaks: no raw relations, no contact settings, no import hashes', async () => {
    const r = await get({ slug: 'slug-' + ID.pub }); const json = JSON.stringify(r.body);
    expect(json).not.toMatch(/internal-contact@example\.test|\+33000000000|contactEmail|contactPhone/); expect(r.body).not.toHaveProperty('proRdvServices'); expect(r.body).not.toHaveProperty('rdvSettings');
    expect(r.body).not.toHaveProperty('raw_data_hash'); expect(r.body).not.toHaveProperty('content_hash');
  });
  it('RDV not published: flag false and the services are hidden even though one is active', async () => {
    const r = await get({ slug: 'slug-' + ID.unpub }); expect(r.statusCode).toBe(200);
    expect(r.body.rdv.isPublished).toBe(false); expect(r.body.is_pro_enabled).toBe(false); expect(r.body.proServices).toEqual([]);
  });
  it('a structure without a settings row falls back to the legacy flag', async () => {
    const r = await get({ slug: 'slug-' + ID.legacy }); expect(r.statusCode).toBe(200); expect(r.body.rdv.isPublished).toBe(true); expect(r.body.proServices).toEqual([]);
  });
  it('404 only for an unknown or inactive structure (never for a query fault)', async () => {
    expect((await get({ slug: 'slug-does-not-exist-' + TS })).statusCode).toBe(404);
    expect((await get({ slug: 'slug-' + ID.inactive })).statusCode).toBe(404);
  });
});
