/**
 * G14 release 3 — on REAL PostgreSQL with the MIGRATED schema (0063): the needs of bookable services and the directory need filter
 * (GET /api/structures?subdomain= / ?domain=), and the places' own booking pages (« Rendez-vous sur leur site »): PENDING until an administrator approves,
 * public only while ADA_EXTERNAL_BOOKING is open, never counted as AccesDirectAide online booking; the CHECK constraints; the open-data proposals.
 * Synthetic rows only; skipped without DATABASE_URL.
 */
import { vi, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const TAG = `G14R3${TS}`;
const CASES = ['tagged', 'untagged', 'taggedUnreviewed', 'external', 'externalOther'];
const id = (k) => `g14r3-${k}-${TS}`;
const svc = (k) => `g14r3-svc-${k}-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end() { return this; } });
const ordinary = (serviceId) => ({ serviceSensitivity: { v: 1, services: { [serviceId]: { value: 'ordinary', reviewedAt: '2026-11-20T10:00:00.000Z', reviewedBy: 'admin@example.test', reason: 'synthétique' } } } });

describe.skipIf(!hasDatabase)('G14 release 3: needs of bookable services and own booking pages (real DB, migration 0063)', () => {
  let db, handler, ext, needs;
  const get = async (query) => { const r = mk(); await handler({ method: 'GET', url: '/api/structures', headers: { host: 'localhost' }, query }, r); return r; };
  const ours = (r) => (r.body.items || []).filter((i) => String(i.nom).startsWith(TAG));
  const keyOf = (i) => String(i.id).replace(`g14r3-`, '').replace(`-${TS}`, '');

  const seed = async (k, { bookable = true, settings } = {}) => {
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees,
      statut, is_pro_enabled, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, site_web, settings_json, "updatedAt", "createdAt")
      VALUES (${id(k)}, ${`${TAG} ${k}`}, ${'slug-' + id(k)}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'],
      'actif', false, true, 'VERIFIED', 'reviewer@example.test', true, 'unclassified', NOW(), 'https://example.test/source', 'https://www.mairie-exemple.fr/',
      ${JSON.stringify(settings === undefined ? ordinary(svc(k)) : settings)}::jsonb, NOW(), NOW())`);
    if (!bookable) return;
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt", "createdAt") VALUES (${'g14r3-set-' + k + '-' + TS}, ${id(k)}, true, 'IN_PERSON', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "isActive", modes, "updatedAt", "createdAt") VALUES (${svc(k)}, ${id(k)}, ${'Accueil ' + k}, 30, true, '{IN_PERSON}'::text[], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", "isActive", modes, "updatedAt") VALUES (${'g14r3-rule-' + k + '-' + TS}, ${id(k)}, 2, '09:00', '12:00', true, '{IN_PERSON}'::text[], NOW())`);
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); ({ default: handler } = await import('../../api/_handlers/structures.js'));
    ext = await import('../../api/_services/external-booking.js'); needs = await import('../../api/_services/service-needs.js');
    const { parseServiceSubdomains } = await import('../../api/lib/service-needs.js');
    await seed('tagged'); await seed('untagged'); await seed('taggedUnreviewed', { settings: {} });
    await seed('external', { bookable: false }); await seed('externalOther', { bookable: false });
    const v = parseServiceSubdomains(['aide-alimentaire', 'acces-aux-droits']);
    await needs.writeServiceNeeds(db, svc('tagged'), v.value);
    await needs.writeServiceNeeds(db, svc('taggedUnreviewed'), v.value);
  });
  afterEach(() => { delete process.env.ADA_EXTERNAL_BOOKING; });
  afterAll(async () => {
    if (!db) return;
    for (const k of CASES) {
      await db.execute(sql`DELETE FROM "StructureExternalBooking" WHERE "structureId" = ${id(k)}`);
      await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${id(k)}`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${id(k)}`);
      await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${id(k)}`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id(k)}`);
    }
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id LIKE ${'g14r3-%-' + TS}`);
  });

  it('the needs are stored per service, read back sorted, and leave with their service (cascade)', async () => {
    const m = await needs.readServiceNeeds(db, [svc('tagged'), svc('untagged')]);
    expect(m.get(svc('tagged'))).toEqual(['acces-aux-droits', 'aide-alimentaire']);
    expect(m.has(svc('untagged'))).toBe(false);
    await expect(db.execute(sql`INSERT INTO "ProRdvServiceSubdomain" ("serviceId", subdomain, domain) VALUES (${svc('untagged')}, 'Pas Valide', 'precarite')`)).rejects.toThrow();
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt", "createdAt") VALUES (${svc('tmp')}, ${id('untagged')}, 'Tmp', 30, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvServiceSubdomain" ("serviceId", subdomain, domain) VALUES (${svc('tmp')}, 'psy', 'sante-mentale')`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${svc('tmp')}`);
    expect((await db.execute(sql`SELECT 1 FROM "ProRdvServiceSubdomain" WHERE "serviceId" = ${svc('tmp')}`)).rows).toHaveLength(0);
  });

  it('?subdomain= lists only the places where a REALLY bookable service carries that need; ?domain= covers its subdomains; an unknown id lists nothing', async () => {
    let r = await get({ subdomain: 'aide-alimentaire', q: TAG, pageSize: '50' });
    expect(r.statusCode).toBe(200);
    expect(ours(r).map(keyOf)).toEqual(['tagged']);
    expect(ours(r)[0].online_booking).toBe(true);
    r = await get({ domain: 'precarite', q: TAG, pageSize: '50' });
    expect(ours(r).map(keyOf)).toEqual(['tagged']);
    r = await get({ subdomain: 'psy', q: TAG, pageSize: '50' });
    expect(ours(r)).toEqual([]);
    r = await get({ subdomain: 'n-existe-pas', q: TAG, pageSize: '50' });
    expect(ours(r)).toEqual([]);
    r = await get({ subdomain: 'aide-alimentaire', domain: 'logement', q: TAG, pageSize: '50' });
    expect(ours(r)).toEqual([]);
  });

  it('an own booking page: PENDING until approved; public only while ADA_EXTERNAL_BOOKING is open; never online_booking', async () => {
    const sub = await ext.submitExternalBooking({ structureId: id('external'), url: 'https://rdv.anct.gouv.fr/org/4242/mairie?address=1+rue+X&latitude=48.5', subdomains: ['aide-alimentaire'], source: 'PRO', by: 'pro-user-1' }, db);
    expect(sub).toMatchObject({ ok: true, changed: true, record: { status: 'PENDING', platform: 'rdv-service-public', url: 'https://rdv.anct.gouv.fr/org/4242/mairie' } });
    process.env.ADA_EXTERNAL_BOOKING = 'open';
    let r = await get({ q: TAG, pageSize: '50' });
    expect(ours(r).find((i) => keyOf(i) === 'external').external_booking).toBeUndefined();
    expect((await ext.reviewExternalBooking({ structureId: id('external'), decision: 'APPROVE', note: 'court', by: 'ops@example.test' }, db)).code).toBe('NOTE_REQUIRED');
    expect(await ext.reviewExternalBooking({ structureId: id('external'), decision: 'APPROVE', note: 'Page publique de la mairie vérifiée', by: 'ops@example.test' }, db)).toMatchObject({ ok: true, previous: 'PENDING', status: 'APPROVED' });
    r = await get({ q: TAG, pageSize: '50' });
    const item = ours(r).find((i) => keyOf(i) === 'external');
    expect(item.external_booking).toEqual({ url: 'https://rdv.anct.gouv.fr/org/4242/mairie', platform: 'rdv-service-public', platformLabel: 'RDV Service Public', host: 'rdv.anct.gouv.fr', subdomains: ['aide-alimentaire'] });
    expect(item.online_booking).toBe(false);
    // the « Rendez-vous en ligne » filter (AccesDirectAide booking) never lists it
    r = await get({ bookable: '1', q: TAG, pageSize: '50' });
    expect(ours(r).map(keyOf).sort()).toEqual(['tagged', 'untagged']);
    // the need filter lists it next to the AccesDirectAide-bookable place; with bookable=1 it does not
    r = await get({ subdomain: 'aide-alimentaire', q: TAG, pageSize: '50' });
    expect(ours(r).map(keyOf).sort()).toEqual(['external', 'tagged']);
    r = await get({ subdomain: 'aide-alimentaire', bookable: '1', q: TAG, pageSize: '50' });
    expect(ours(r).map(keyOf)).toEqual(['tagged']);
    // the detail page
    const d = mk(); await handler({ method: 'GET', url: `/api/structures/slug-${id('external')}`, headers: { host: 'localhost' }, query: {} }, d);
    expect(d.statusCode).toBe(200); expect(d.body.external_booking).toMatchObject({ platform: 'rdv-service-public' }); expect(d.body.is_pro_enabled).toBe(false);
    expect(JSON.stringify(d.body)).not.toMatch(/ops@example\.test|pro-user-1|Page publique de la mairie/);
    // closed: nothing public, the filter falls back to AccesDirectAide booking only
    delete process.env.ADA_EXTERNAL_BOOKING;
    r = await get({ q: TAG, pageSize: '50' });
    expect(ours(r).some((i) => i.external_booking)).toBe(false);
    r = await get({ subdomain: 'aide-alimentaire', q: TAG, pageSize: '50' });
    expect(ours(r).map(keyOf)).toEqual(['tagged']);
    const d2 = mk(); await handler({ method: 'GET', url: `/api/structures/slug-${id('external')}`, headers: { host: 'localhost' }, query: {} }, d2);
    expect(d2.body.external_booking).toBeUndefined();
  });

  it('« platforms » shows only recognised platforms; a changed page goes back to PENDING; an import never overrides the structure\'s page', async () => {
    await ext.submitExternalBooking({ structureId: id('externalOther'), url: 'https://www.mairie-exemple.fr/rendez-vous', source: 'ADMIN', by: 'ops@example.test' }, db);
    await ext.reviewExternalBooking({ structureId: id('externalOther'), decision: 'APPROVE', note: 'Même domaine que le site de la fiche', by: 'ops@example.test' }, db);
    process.env.ADA_EXTERNAL_BOOKING = 'platforms';
    let r = await get({ q: TAG, pageSize: '50' });
    expect(ours(r).filter((i) => i.external_booking).map(keyOf)).toEqual(['external']);
    process.env.ADA_EXTERNAL_BOOKING = 'open';
    r = await get({ q: TAG, pageSize: '50' });
    expect(ours(r).filter((i) => i.external_booking).map(keyOf).sort()).toEqual(['external', 'externalOther']);
    // the queue shows the domain check for the reviewer
    const approved = await ext.listExternalBookings({ status: 'APPROVED' }, db);
    expect(approved.find((x) => x.structureId === id('externalOther'))).toMatchObject({ sameHostAsWebsite: true, urlValid: true, source: 'ADMIN' });
    // the structure changes its page: PENDING again, hidden
    const changed = await ext.submitExternalBooking({ structureId: id('externalOther'), url: 'https://www.mairie-exemple.fr/rdv-nouveau', source: 'PRO', by: 'pro-user-2' }, db);
    expect(changed.record).toMatchObject({ status: 'PENDING', reviewedAt: null });
    r = await get({ q: TAG, pageSize: '50' });
    expect(ours(r).filter((i) => i.external_booking).map(keyOf)).toEqual(['external']);
    // an open-data proposal never replaces it
    const out = await ext.proposeImportedExternalBookings(new Map([[id('externalOther'), { url: 'https://autre-site.fr/rdv', ref: 'data-inclusion:x' }], [id('untagged'), { url: 'https://www.asso-exemple.fr/rdv', ref: 'data-inclusion:y' }]]), {}, db);
    expect(out).toMatchObject({ available: true, proposed: 1, kept: 1 });
    expect(await ext.readExternalBooking(id('externalOther'), db)).toMatchObject({ url: 'https://www.mairie-exemple.fr/rdv-nouveau', source: 'PRO' });
    expect(await ext.readExternalBooking(id('untagged'), db)).toMatchObject({ status: 'PENDING', source: 'IMPORT', url: 'https://www.asso-exemple.fr/rdv' });
    // journal: identifiers and decisions only
    const audit = (await db.execute(sql`SELECT action, details::text AS d FROM "AuditLog" WHERE entity_id = ${id('externalOther')} ORDER BY timestamp`)).rows;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['external_booking.submitted', 'external_booking.reviewed']));
    for (const a of audit) expect(a.d).not.toMatch(/https?:|Même domaine/);
  });

  it('the CHECK constraints refuse what the code refuses: a non-https URL, an approval without a named reviewer, an unknown status or source', async () => {
    const ins = (url, status = 'PENDING', source = 'PRO', reviewedBy = null) => db.execute(sql`INSERT INTO "StructureExternalBooking" ("structureId", url, status, source, "reviewedBy", "reviewedAt")
      VALUES (${id('tagged')}, ${url}, ${status}, ${source}, ${reviewedBy}, ${reviewedBy ? new Date().toISOString() : null})`);
    await expect(ins('http://www.example.org/rdv')).rejects.toThrow();
    await expect(ins('https://user@www.example.org/rdv')).rejects.toThrow();
    await expect(ins('https://www.example.org/rdv', 'APPROVED')).rejects.toThrow();
    await expect(ins('https://www.example.org/rdv', 'LIVE')).rejects.toThrow();
    await expect(ins('https://www.example.org/rdv', 'PENDING', 'SCRAPER')).rejects.toThrow();
    await ins('https://www.example.org/rdv', 'APPROVED', 'ADMIN', 'ops@example.test');
    await db.execute(sql`DELETE FROM "StructureExternalBooking" WHERE "structureId" = ${id('tagged')}`);
  });
});
