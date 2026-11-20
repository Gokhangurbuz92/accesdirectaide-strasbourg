/**
 * G8 — public indicators of the Observatoire on a REAL PostgreSQL (all migrations). Figures are checked as DELTAS around this suite's own rows, so other rows
 * of the database do not matter.
 *   C  catalogue and freshness follow the STRICT D-5 rule: a stale, a LAB-origin and an Aides-territoires record are never counted (even in ADA_PUBLIC_CONTENT_MODE=lab)
 *   L  link health: the last result per address, only for records visible now, only within 35 days, never an address that was not requested
 *   T  translations: a translation made on another version of the French text is not counted
 *   P  privacy: no identifier, name, contact, address, URL of a record appears in the answer, and the queries read no table that holds a person's data
 *   H  the handler end to end: 404 closed, 200 open, the same body passes assertAggregateOnly
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const P = `g8o-${TS}`;
const URL_OK = `https://www.service-public.fr/${P}/ok`;
const URL_404 = `https://www.service-public.fr/${P}/gone`;
const URL_FIXED = `https://www.service-public.fr/${P}/fixed`;
const URL_HIDDEN = `https://www.service-public.fr/${P}/hidden`;
const URL_OLD = `https://www.service-public.fr/${P}/old`;
const URL_NULL = `https://example.org/${P}/outside`;
// QA v59 (19/11): the first translation slug (« aah ») may already exist in a shared, seeded test DB (Aide.slug is unique) — the hook then failed and
// every test was skipped. The slug is now chosen in beforeAll among translation files whose slug is not in the DB.
const TRANSLATION_SLUGS = fs.readdirSync('data/translations/aide').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
let TRANSLATED_SLUG;
const PERSONAL_TABLES = ['CitizenUser', 'ProUser', 'AdminUser', 'ProAppointment', 'Referral', 'ReferralEvent', 'AuditLog', 'ConversationLog', 'CitizenHistoryEntry', 'ParcoursItem',
  'SharedDiagnostic', 'ObservatoryQuarterSnapshot', 'AiMetric', 'CitizenProfile', 'SupportRequest', 'ConsentLog', 'ContentVerification'];

describe.skipIf(!hasDatabase)('G8 public indicators (real DB)', () => {
  let db, compute, handler, reset, assertAggregateOnly;
  let before, after; const queries = [];

  const aide = (id, { days = 5, origin = 'official', cat = 'LOGEMENT', scope = 'NATIONAL', url = null, provider = null, slug = null, theme = null } = {}) => sql`INSERT INTO "Aide"
    (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, category_code, territory_scope, "providerName", theme, "updatedAt")
    VALUES (${id}, ${slug || id}, ${'Aide ' + id}, 'publie', true, 'VERIFIED', 'reviewer-g8@example.test', true, NOW() - make_interval(days => ${days}), ${origin},
      ${url || `https://www.service-public.fr/${P}/${id}`}, ${cat}::"AidCategoryCode", ${scope}, ${provider}, ${theme}, NOW())`;
  const structure = (id, ville, cp, { pmr = false, hours = null, visible = true } = {}) => sql`INSERT INTO "Structure"
    (id, slug, nom, ville, code_postal, adresse, email, telephone, services, publics_accueillis, categories_aidees, statut, launch_eligible, verification_status, verified_by,
     territory_verified, date_verification, data_origin, source_url, accessibilite_pmr, horaires, "updatedAt")
    VALUES (${id}, ${id}, ${'Lieu ' + id}, ${ville}, ${cp}, ${'12 rue ' + id}, ${id + '@example.test'}, '0388123456', '{}', '{}', '{}', ${visible ? 'actif' : 'brouillon'}, true, 'VERIFIED',
      'reviewer-g8@example.test', true, NOW() - interval '3 days', 'official', ${`https://annuaire.service-public.fr/${P}/${id}`}, ${pmr}, ${hours}, NOW())`;
  const snap = (entityId, url, status, daysAgo) => sql`INSERT INTO "SourceSnapshot" (id, entity_type, entity_id, fetched_at, raw_excerpt, http_status, final_url, "createdAt")
    VALUES (gen_random_uuid()::text, 'Aide', ${entityId}, NOW() - make_interval(days => ${daysAgo}), ${'link:' + url}, ${status}, ${url}, NOW())`;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ computePublicIndicators: compute } = await import('../../api/_services/public-indicators.js'));
    ({ default: handler, _resetIndicatorsCache: reset } = await import('../../api/_handlers/public/indicators.js'));
    ({ assertAggregateOnly } = await import('../../api/lib/public-indicators.js'));
    const taken = new Set(((await db.execute(sql`SELECT slug FROM "Aide" WHERE slug IS NOT NULL`)).rows || []).map((r) => r.slug));
    TRANSLATED_SLUG = TRANSLATION_SLUGS.find((x) => !taken.has(x));
    if (!TRANSLATED_SLUG) throw new Error('every translated slug already exists in this DB: the T case cannot be built');
    before = await compute({ db });
    const ids = (s) => `${P}-${s}`;
    await db.execute(aide(ids('a1'), { days: 5, scope: 'NATIONAL', url: URL_OK, theme: 'Logement' }));
    await db.execute(aide(ids('a2'), { days: 10, scope: 'COMMUNAL', cat: 'SANTE', url: URL_404, theme: 'Social - Santé' }));
    await db.execute(aide(ids('a3'), { days: 120, scope: 'something-else', url: URL_FIXED, theme: '   ' }));                // visible, « à revoir »
    await db.execute(aide(ids('stale'), { days: 200, url: URL_HIDDEN, theme: 'Logement' }));                                     // not visible (> 180 days)
    await db.execute(aide(ids('lab'), { origin: 'synthetic_fixture' }));                                      // LAB fixture: never a verified record
    await db.execute(aide(ids('fund'), { provider: 'aides-territoires' }));                                   // C11 / D08: never a citizen aide
    await db.execute(aide(ids('tr'), { slug: TRANSLATED_SLUG, cat: 'FAMILLE' }));                             // visible, its translation file is of another text
    for (let i = 0; i < 6; i += 1) await db.execute(structure(ids(`s${i}`), 'Strasbourg', '67000', { pmr: i < 2, hours: i < 3 ? 'Lun-Ven 9h-12h' : i === 3 ? '   ' : null }));
    await db.execute(structure(ids('s6'), 'Schiltigheim', '67300'));
    await db.execute(structure(ids('s7'), 'Schiltigheim', '67300'));
    await db.execute(structure(ids('draft'), 'Strasbourg', '67000', { visible: false, pmr: true }));
    await db.execute(snap(ids('a1'), URL_OK, 200, 2));
    await db.execute(snap(ids('a2'), URL_404, 404, 2));
    await db.execute(snap(ids('a3'), URL_FIXED, 404, 9));
    await db.execute(snap(ids('a3'), URL_FIXED, 200, 1));      // the last result wins
    await db.execute(snap(ids('stale'), URL_HIDDEN, 200, 1));  // record not visible now
    await db.execute(snap(ids('a1'), URL_OLD, 500, 60));       // older than 35 days
    await db.execute(snap(ids('a1'), URL_NULL, null, 1));      // outside the allow-list: never requested
    // record every query the computation sends
    const spy = { execute: (q) => { queries.push(new PgDialect().sqlToQuery(q).sql); return db.execute(q); } };
    after = await compute({ db: spy });
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    delete process.env.ADA_PUBLIC_INDICATORS;
    await db.execute(sql`DELETE FROM "SourceSnapshot" WHERE entity_id LIKE ${`${P}-%`}`);
    await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`${P}-%`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`${P}-%`}`);
  });

  it('C catalogue and freshness: strict D-5 only (stale, LAB-origin and Aides-territoires records are not counted)', () => {
    expect(process.env.ADA_PUBLIC_CONTENT_MODE, 'runs with the LAB content mode: the strict rule must still apply').toBe('lab');
    expect(after.catalogue.aides - before.catalogue.aides).toBe(4);
    expect(after.freshness.aide.current - before.freshness.aide.current).toBe(3);
    expect(after.freshness.aide.updateNeeded - before.freshness.aide.updateNeeded).toBe(1);
    expect(after.catalogue.structures - before.catalogue.structures).toBe(8);
    const dom = (b, d) => b.aidesByDomain.find((x) => x.domain === d).count;
    expect(dom(after, 'LOGEMENT') - dom(before, 'LOGEMENT')).toBe(2);
    expect(dom(after, 'SANTE') - dom(before, 'SANTE')).toBe(1);
    expect(dom(after, 'FAMILLE') - dom(before, 'FAMILLE')).toBe(1);
    expect(after.aidesByDomain.map((x) => x.domain)).toContain('ALIMENTATION');   // every domain listed, zero included
    const sc = (b, s) => b.aidesByScope.find((x) => x.scope === s).count;
    expect(sc(after, 'NATIONAL') - sc(before, 'NATIONAL')).toBe(2);
    expect(sc(after, 'COMMUNAL') - sc(before, 'COMMUNAL')).toBe(1);
    expect(sc(after, 'UNSPECIFIED') - sc(before, 'UNSPECIFIED')).toBe(1);
    // G12: the source's own theme, visible records only; blank = « non indiqué » (null), listed last
    const th = (b, x) => (b.aidesBySourceTheme.find((r) => r.theme === x) || { count: 0 }).count;
    expect(th(after, 'Logement') - th(before, 'Logement')).toBe(1);
    expect(th(after, 'Social - Santé') - th(before, 'Social - Santé')).toBe(1);
    expect(th(after, null) - th(before, null)).toBe(2);   // a3 blank + tr without theme
    expect(after.aidesBySourceTheme.at(-1).theme).toBeNull();
    expect(after.aidesBySourceTheme.reduce((n, r) => n + r.count, 0)).toBe(after.catalogue.aides);
  });

  it('C structures: practical information and the commune table with its suppression', () => {
    expect(after.structuresInformation.visible - before.structuresInformation.visible).toBe(8);
    expect(after.structuresInformation.stepFreeAccessIndicated - before.structuresInformation.stepFreeAccessIndicated).toBe(2);
    expect(after.structuresInformation.openingHoursIndicated - before.structuresInformation.openingHoursIndicated).toBe(3);   // blank hours are no hours
    const t = after.structuresByCommune;
    expect(t.kMin).toBe(5);
    const strasbourg = t.cells.find((c) => c.commune === '67482');
    const strasbourgBefore = before.structuresByCommune.cells.find((c) => c.commune === '67482')?.count ?? 0;
    expect(strasbourg, 'six places reach the threshold: Strasbourg is published').toBeTruthy();
    expect(strasbourg.count - strasbourgBefore).toBe(6);
    expect(t.cells.find((c) => c.commune === '67447'), 'Schiltigheim (2 places) is masked').toBeUndefined();
    // Schiltigheim has 2 of this suite's places (plus any others): below 5 alone, it must never be published with a count below 5
    for (const c of t.cells) expect(c.count).toBeGreaterThanOrEqual(5);
    if (t.notLocated !== null) expect(t.notLocated === 0 || t.notLocated >= 5).toBe(true);
  });

  it('L link health: last result per address, visible records only, 35-day window, requested addresses only', () => {
    expect(after.linkHealth.measured).toBe(true);
    const d = (k) => (after.linkHealth[k] ?? 0) - (before.linkHealth[k] ?? 0);
    expect(d('addresses')).toBe(3);
    expect(d('reachable')).toBe(2);
    expect(d('broken')).toBe(1);
    expect(d('inconclusive')).toBe(0);
    expect(after.linkHealth.lastCheckedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('T a translation of another version of the French text is not counted', () => {
    for (const lang of Object.keys(after.translations.languages)) {
      const a = after.translations.languages[lang].aide; const b = before.translations.languages[lang].aide;
      expect(a.full + a.partial, lang).toBe(b.full + b.partial);
    }
    expect(Object.keys(after.translations.languages).sort()).toEqual(['ar', 'de', 'en', 'tr', 'uk']);
    expect(after.translations.of.aide).toBe(after.catalogue.aides);
  });

  it('P no identifier, name, contact, address or URL of a record, and no table holding a person\'s data is read', () => {
    const body = JSON.stringify(after);
    expect(body).not.toContain(P);
    expect(body).not.toMatch(/reviewer-g8|example\.test|0388123456|rue |service-public\.fr|Lieu |Aide g8o/);
    expect(assertAggregateOnly(after)).toBe(true);
    expect(queries.length).toBeGreaterThan(5);
    const all = queries.join('\n');
    for (const t of PERSONAL_TABLES) expect(all, t).not.toMatch(new RegExp(`"${t}"`));
    // the only tables read are the public catalogue and the link-check results
    const tables = new Set([...all.matchAll(/(?:FROM|JOIN)\s+"([A-Za-z_]+)"/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(['Actualite', 'Aide', 'Demarche', 'Dispositif', 'Guide', 'SourceSnapshot', 'Structure']);
  });

  it('H the handler: 404 while closed, 200 once open, with the same aggregates', async () => {
    const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });
    reset(); delete process.env.ADA_PUBLIC_INDICATORS;
    let r = mk(); await handler({ method: 'GET', headers: {} }, r);
    expect(r.statusCode).toBe(404);
    process.env.ADA_PUBLIC_INDICATORS = 'open';
    r = mk(); await handler({ method: 'GET', headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.schema).toBe('ada.public-indicators.v1');
    expect(r.body.catalogue.aides).toBe(after.catalogue.aides);
    expect(Date.now() - Date.parse(r.body.computedAt)).toBeLessThan(120000);
  });
});
