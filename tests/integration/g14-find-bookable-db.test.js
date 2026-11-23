/**
 * G14-FIND — the Annuaire « Rendez-vous en ligne » filter and badge (GET /api/structures?bookable=1, `online_booking` on each item) on REAL PostgreSQL with
 * the MIGRATED schema. Contract: only a place that can really be asked for an appointment online now appears under the filter or carries the flag —
 * published booking, active AND identity-verified organisation, an active service an administrator reviewed as « ordinary », offered in an open modality,
 * with an active opening period serving it (and, with team choice on, a professional who takes bookings). Every « almost bookable » place below misses
 * exactly ONE of these and must never show. While booking is closed on the deployment the filter matches nothing and no item is flagged. The flag costs a
 * fixed number of queries per page (no query per place). Synthetic rows only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const TAG = `G14F${TS}`;
// one key per case: `ok` is the only bookable place
const CASES = ['ok', 'unverified', 'brouillon', 'sensitiveOnly', 'unreviewed', 'noSlot', 'inactiveService', 'videoOnly', 'teamNoMember', 'unpublished', 'reviewIncomplete'];
const id = (k) => `g14f-${k}-${TS}`;
const svc = (k) => `g14f-svc-${k}-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end() { return this; } });
const ordinary = (serviceId, extra = {}) => ({ serviceSensitivity: { v: 1, services: { [serviceId]: { value: 'ordinary', reviewedAt: '2026-11-20T10:00:00.000Z', reviewedBy: 'admin@example.test', reason: 'synthétique', ...extra } } } });

describe.skipIf(!hasDatabase)('G14-FIND: the online-booking filter and badge on the migrated schema (real DB)', () => {
  let db, handler;
  const get = async (query) => { const r = mk(); await handler({ method: 'GET', url: '/api/structures', headers: { host: 'localhost' }, query }, r); return r; };

  /** a place with every condition met, then `change` breaks exactly one */
  const seed = async (k, change = {}) => {
    const c = { statut: 'actif', verification: 'VERIFIED', published: true, bookingMode: 'IN_PERSON', serviceActive: true, serviceModes: '{IN_PERSON}', ruleActive: true,
      settings: ordinary(svc(k)), ...change };
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees,
      statut, is_pro_enabled, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, settings_json, "updatedAt", "createdAt")
      VALUES (${id(k)}, ${`${TAG} ${k}`}, ${'slug-' + id(k)}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'],
      ${c.statut}, false, true, ${c.verification}, 'reviewer@example.test', true, 'unclassified', NOW(), 'https://example.test/source', ${JSON.stringify(c.settings)}::jsonb, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt", "createdAt") VALUES (${'g14f-set-' + k + '-' + TS}, ${id(k)}, ${c.published}, ${c.bookingMode}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "isActive", modes, "updatedAt", "createdAt") VALUES (${svc(k)}, ${id(k)}, ${'Accueil ' + k}, 30, ${c.serviceActive}, ${c.serviceModes}::text[], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", "isActive", modes, "updatedAt") VALUES (${'g14f-rule-' + k + '-' + TS}, ${id(k)}, 2, '09:00', '12:00', ${c.ruleActive}, '{IN_PERSON,VIDEO}'::text[], NOW())`);
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); ({ default: handler } = await import('../../api/_handlers/structures.js'));
    await seed('ok');
    await seed('unverified', { verification: 'UNVERIFIED' });   // visible in the LAB listing (data_origin unclassified), but not an identity-verified organisation
    await seed('brouillon', { statut: 'brouillon' });
    await seed('sensitiveOnly', { settings: ordinary(svc('sensitiveOnly'), { value: 'sensitive' }) });
    await seed('unreviewed', { settings: {} });
    await seed('noSlot', { ruleActive: false });
    await seed('inactiveService', { serviceActive: false });
    await seed('videoOnly', { bookingMode: 'BOTH', serviceModes: '{VIDEO}' });   // video is not open in this environment
    await seed('teamNoMember', { settings: { ...ordinary(svc('teamNoMember')), rdvBooking: { v: 1, confirmation: 'DIRECT', services: {}, team: { enabled: true, members: {} } } } });
    await seed('unpublished', { published: false });
    await seed('reviewIncomplete', { settings: ordinary(svc('reviewIncomplete'), { reviewedBy: ' ' }) });
  });
  afterAll(async () => {
    if (!db) return;
    for (const k of CASES) {
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${id(k)}`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${id(k)}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${id(k)}`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id(k)}`);
    }
  });

  it('the filter returns ONLY the place that can really be booked online now', async () => {
    const r = await get({ q: TAG, bookable: '1', limit: '50' });
    expect(r.statusCode, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.items.map((s) => s.id)).toEqual([id('ok')]);
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.items[0].online_booking).toBe(true);
  });

  it('without the filter, the listing keeps every visible place and flags only the bookable one (unverified, sensitive-only, no slot… never flagged)', async () => {
    const r = await get({ q: TAG, limit: '50' });
    expect(r.statusCode).toBe(200);
    const flags = Object.fromEntries(r.body.items.map((s) => [s.id, s.online_booking]));
    expect(flags[id('ok')]).toBe(true);
    for (const k of CASES.filter((x) => x !== 'ok' && x !== 'brouillon')) expect(flags[id(k)], k).toBe(false);
    expect(flags).not.toHaveProperty(id('brouillon'));   // a draft is not public at all
    expect(Object.keys(flags).length).toBe(CASES.length - 1);
  });

  it('booking closed on the deployment (restricted beta without appointments + accounts): the filter matches nothing, no item is flagged', async () => {
    const saved = { r: process.env.ADA_PUBLIC_BETA_RESTRICTED, o: process.env.ADA_BETA_OPEN_SURFACES };
    try {
      process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; process.env.ADA_BETA_OPEN_SURFACES = '';
      const f = await get({ q: TAG, bookable: '1' }); expect(f.statusCode).toBe(200); expect(f.body.items).toEqual([]); expect(f.body.pagination.total).toBe(0);
      const l = await get({ q: TAG, limit: '50' }); expect(l.body.items.length).toBe(CASES.length - 1); expect(l.body.items.every((s) => s.online_booking === false)).toBe(true);
      // appointments alone is not enough: a request needs a citizen account (R47 F1)
      process.env.ADA_BETA_OPEN_SURFACES = 'appointments';
      expect((await get({ q: TAG, bookable: '1' })).body.items).toEqual([]);
      process.env.ADA_BETA_OPEN_SURFACES = 'appointments,accounts';
      expect((await get({ q: TAG, bookable: '1' })).body.items.map((s) => s.id)).toEqual([id('ok')]);
    } finally {
      if (saved.r === undefined) delete process.env.ADA_PUBLIC_BETA_RESTRICTED; else process.env.ADA_PUBLIC_BETA_RESTRICTED = saved.r;
      if (saved.o === undefined) delete process.env.ADA_BETA_OPEN_SURFACES; else process.env.ADA_BETA_OPEN_SURFACES = saved.o;
    }
  });

  it('no query per place: the number of SQL statements of a page does not grow with the page size', async () => {
    const { searchStructures } = await import('../../api/lib/search-query.js');
    const count = async (pageSize, extra = {}) => {
      const spy = vi.spyOn(db, 'execute'); const spyFind = vi.spyOn(db.query.Structure, 'findMany');
      try { const out = await searchStructures({ page: 1, pageSize, sort: 'quality', departement: undefined, ...extra }); return { n: spy.mock.calls.length + spyFind.mock.calls.length, items: out.items.length }; } finally { spy.mockRestore(); spyFind.mockRestore(); }
    };
    const small = await count(2); const large = await count(40);
    expect(large.items).toBeGreaterThan(small.items);
    expect(large.n).toBe(small.n);
    const filtered = await count(40, { bookable: '1' });
    expect(filtered.n).toBeLessThanOrEqual(large.n);
  });

  it('an invalid value of the parameter is refused (400), never ignored', async () => {
    expect((await get({ bookable: 'yes' })).statusCode).toBe(400);
  });
});
