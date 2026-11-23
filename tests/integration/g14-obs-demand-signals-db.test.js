/**
 * G14-OBS — anonymous demand signals on a REAL PostgreSQL (all migrations, 0062 included). The suite writes only in the quarters 2013-T3 / 2013-T4 and its
 * own prefixed structures, so other rows of the database do not matter.
 *   D  the database refuses every other shape: unknown signal, free-text code, a commune on a non-search signal or outside the Eurométropole, a negative count
 *   W  recording: nothing while closed; open → one row per (day, signal, code, commune), counts summed; a sensitive subdomain never carries a commune;
 *      the search query is never written anywhere
 *   F  freeze: the closed quarter is published once (cells below 5 masked) and its daily counts DELETED; the running quarter is kept; UPDATE refused;
 *      a second run changes nothing; appointment requests of one organisation stay masked (C8 rules)
 *   P  the public answer and the CSV: aggregates only (assertAggregateOnly), the frozen quarter, the supply of the public directory; no table holding a
 *      person's data is read to answer
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const P = `g14obs-${TS}`;
const OPEN = { ADA_DEMAND_SIGNALS: 'search,situation,parcours,referral' };
const IN_Q3 = new Date('2013-08-15T10:00:00Z');
const AFTER = new Date('2013-10-05T06:17:00Z');
const PERSONAL_TABLES = ['CitizenUser', 'ProUser', 'AdminUser', 'Referral', 'ReferralEvent', 'AuditLog', 'ConversationLog', 'CitizenHistoryEntry', 'ParcoursItem', 'ParcoursEvent',
  'SharedDiagnostic', 'CitizenProfile', 'SupportRequest', 'ConsentLog'];

describe.skipIf(!hasDatabase)('G14-OBS demand signals (real DB)', () => {
  let db; let S; let L; let assertAggregateOnly; let handler; let reset;
  const rows = async (q) => (await db.execute(q)).rows;
  const structure = (id, type, { ville = 'Strasbourg', cp = '67000', hours = null, services = '{}' } = {}) => sql`INSERT INTO "Structure"
    (id, slug, nom, ville, code_postal, adresse, type_structure, services, publics_accueillis, categories_aidees, statut, launch_eligible, verification_status, verified_by,
     territory_verified, date_verification, data_origin, source_url, horaires, is_pro_enabled, "updatedAt")
    VALUES (${id}, ${id}, ${'Lieu ' + id}, ${ville}, ${cp}, ${'1 rue ' + id}, ${type}, ${services}, '{}', '{}', 'actif', true, 'VERIFIED', 'reviewer-g14obs@example.test', true,
      NOW() - interval '3 days', 'official', ${`https://annuaire.service-public.fr/${P}/${id}`}, ${hours}, true, NOW())`;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    S = await import('../../api/_services/demand-signals.js');
    L = await import('../../api/lib/demand-signals.js');
    ({ assertAggregateOnly } = await import('../../api/lib/public-indicators.js'));
    ({ default: handler, _resetObservatoireCache: reset } = await import('../../api/_handlers/public/observatoire.js'));
    S.forgetDemandSchema(db);
    await db.execute(sql`DELETE FROM "DemandSignalDaily" WHERE day >= '2013-07-01' AND day < '2014-01-01'`);
    await db.execute(sql`DELETE FROM "DemandSignalQuarter" WHERE quarter LIKE '2013-%'`);
    // the public directory: 6 CCAS in Strasbourg (one bookable, three with hours), one in Schiltigheim, one outside the Eurométropole, one draft
    for (let i = 0; i < 6; i += 1) await db.execute(structure(`${P}-s${i}`, 'CCAS (centre communal d\'action sociale)', { hours: i < 3 ? 'Lun 9h-12h' : null }));
    await db.execute(structure(`${P}-sch`, 'CCAS (centre communal d\'action sociale)', { ville: 'Schiltigheim', cp: '67300' }));
    await db.execute(structure(`${P}-out`, 'CCAS (centre communal d\'action sociale)', { ville: 'Colmar', cp: '68000' }));
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${`${P}-svc`}, ${`${P}-s0`}, 'S', 30, NOW())`);
    // 6 appointment requests in 2013-T3 at ONE organisation: never published (C8: fewer than 4 contributors)
    for (let i = 0; i < 6; i += 1) {
      const at = new Date(Date.UTC(2013, 7, 10 + i, 9));
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdAt", "updatedAt")
        VALUES (${`${P}-a${i}`}, ${`${P}-s0`}, ${`${P}-svc`}, ${at}, ${new Date(at.getTime() + 1_800_000)}, 'booked', 'Personne Test', ${at}, NOW())`);
    }
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    delete process.env.ADA_OBSERVATOIRE;
    await db.execute(sql`DELETE FROM "DemandSignalDaily" WHERE day >= '2013-07-01' AND day < '2014-01-01'`);
    await db.execute(sql`DELETE FROM "DemandSignalQuarter" WHERE quarter LIKE '2013-%'`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id LIKE ${`${P}-%`}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id LIKE ${`${P}-%`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`${P}-%`}`);
  });

  it('D the database refuses every shape but a closed-list code, a day, a search commune and a count', async () => {
    const bad = [
      sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ('2013-08-01', 'page_view', 'x', '', 1)`,
      sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ('2013-08-01', 'search_need', 'je cherche un logement', '', 1)`,
      sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ('2013-08-01', 'situation', 'dettes', '67482', 1)`,
      sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ('2013-08-01', 'search_need', 'psy', '75056', 1)`,
      sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ('2013-08-01', 'search_need', 'psy', '', -1)`,
    ];
    for (const q of bad) await expect(db.execute(q)).rejects.toThrow();
    const cols = (await rows(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'DemandSignalDaily' ORDER BY ordinal_position`)).map((r) => r.column_name);
    expect(cols).toEqual(['day', 'signal', 'code', 'commune', 'count']);
  });

  it('W nothing is written while closed; open, only codes, summed per day', async () => {
    expect(await S.recordSearch({ needs: [{ id: 'aide-alimentaire' }] }, { territory: '67482' }, { db, env: {}, now: IN_Q3 })).toBe(0);
    expect(await rows(sql`SELECT * FROM "DemandSignalDaily" WHERE day = '2013-08-15'`)).toEqual([]);
    const analysis = { needs: [{ id: 'aide-alimentaire' }, { id: 'violences-conjugales' }, { id: 'not-a-subdomain' }], query: 'je suis battue et sans argent' };
    for (let i = 0; i < 3; i += 1) await S.recordSearch(analysis, { category: 'LOGEMENT', territory: '67482' }, { db, env: OPEN, now: IN_Q3 });
    await S.recordSituation('dettes', { db, env: OPEN, now: IN_Q3 });
    await S.recordSituation('<script>', { db, env: OPEN, now: IN_Q3 });
    await S.recordParcoursAdded('RSA_DEMANDE', { db, env: OPEN, now: IN_Q3 });
    await S.recordSocialReferral(['HOUSING', 'HOUSING', 'HEALTH'], { db, env: OPEN, now: IN_Q3 });
    const got = await rows(sql`SELECT signal, code, commune, count FROM "DemandSignalDaily" WHERE day = '2013-08-15' ORDER BY signal, code`);
    expect(got).toEqual([
      { signal: 'parcours_added', code: 'RSA_DEMANDE', commune: '', count: 1 },
      { signal: 'search_category', code: 'LOGEMENT', commune: '', count: 3 },
      { signal: 'search_need', code: 'aide-alimentaire', commune: '67482', count: 3 },
      { signal: 'search_need', code: 'violences-conjugales', commune: '', count: 3 },
      { signal: 'situation', code: 'dettes', commune: '', count: 1 },
      { signal: 'social_referral', code: 'HOUSING', commune: '', count: 1 },
    ]);
    expect(JSON.stringify(await rows(sql`SELECT * FROM "DemandSignalDaily"`))).not.toMatch(/battue|argent|script|HEALTH/);
  });

  it('F freeze: published once with suppression, daily counts deleted, running quarter kept, UPDATE refused, idempotent', async () => {
    // volume for 2013-T3: 27 more food searches in Strasbourg (30 with W), 6 in Schiltigheim, 2 « urgence sociale »; one count in the running quarter 2013-T4
    await db.execute(sql`INSERT INTO "DemandSignalDaily" (day, signal, code, commune, count) VALUES ('2013-09-01', 'search_need', 'aide-alimentaire', '67482', 27),
      ('2013-09-02', 'search_need', 'aide-alimentaire', '67447', 6), ('2013-09-03', 'search_need', 'urgence-sociale', '', 2), ('2013-10-02', 'search_need', 'aide-alimentaire', '67482', 4)`);
    const out = await S.freezeDemandQuarters(db, AFTER);
    expect(out).toMatchObject({ ok: true, available: true, frozen: ['2013-T3'] });
    expect(out.deletedDailyRows).toBeGreaterThanOrEqual(9);
    expect(await rows(sql`SELECT count(*)::int AS n FROM "DemandSignalDaily" WHERE day >= '2013-07-01' AND day < '2013-10-01'`)).toEqual([{ n: 0 }]);
    expect(await rows(sql`SELECT day::text, count FROM "DemandSignalDaily" WHERE day >= '2013-10-01' AND day < '2014-01-01'`)).toEqual([{ day: '2013-10-02', count: 4 }]);
    const [row] = await rows(sql`SELECT published, rules, "schemaVersion" FROM "DemandSignalQuarter" WHERE quarter = '2013-T3'`);
    const p = row.published;
    expect(row.schemaVersion).toBe('ada.observatoire-demand-quarter.v1');
    expect(row.rules).toMatchObject({ kMin: 5, communeTableMin: 20 });
    const prec = p.search.domains.find((d) => d.domain === 'precarite');
    expect(prec.subdomains.find((x) => x.code === 'aide-alimentaire').value).toBe(36);
    expect(prec.subdomains.find((x) => x.code === 'urgence-sociale').value).toBeNull();
    expect(prec.byCommune.communes.find((c) => c.commune === '67482').value).toBe(30);
    expect(p.search.domains.find((d) => d.domain === 'violences').byCommune).toBeNull();
    expect(p.situations.codes.find((c) => c.code === 'dettes').value, '1 situation: masked').toBeNull();
    expect(p.collected).toMatchObject({ search: { from: '2013-08-15', to: '2013-09-03' }, situation: { from: '2013-08-15', to: '2013-08-15' } });
    expect(p.bookings.byDomain.find((b) => b.domain === 'precarite').requested, 'one organisation: masked').toBeNull();
    expect(p.gaps.byDomain.find((g) => g.domain === 'precarite').kind).toBe('RATIO');
    // every published demand cell is ≥ 5
    const cells = JSON.stringify(p.search) + JSON.stringify([p.categories, p.situations, p.parcoursAdded, p.parcoursClosed, p.referrals]);
    for (const m of cells.matchAll(/"value":(\d+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(5);
    const refused = await db.execute(sql`UPDATE "DemandSignalQuarter" SET release = 'x' WHERE quarter = '2013-T3'`).then(() => null, (e) => e);
    expect(String(refused?.cause?.message || refused?.message)).toMatch(/frozen: UPDATE refused/);
    const again = await S.freezeDemandQuarters(db, AFTER);
    expect(again.frozen).toEqual([]);
    expect(await rows(sql`SELECT count(*)::int AS n FROM "DemandSignalQuarter" WHERE quarter = '2013-T3'`)).toEqual([{ n: 1 }]);
  });

  it('P the public answer and the CSV: aggregates only, no personal table read', async () => {
    const queries = [];
    const spy = { execute: (q) => { queries.push(new PgDialect().sqlToQuery(q).sql); return db.execute(q); } };
    S.forgetDemandSchema(spy);
    const body = await S.publicObservatoire(spy, AFTER);
    expect(assertAggregateOnly(body)).toBe(true);
    expect(body.quarters.find((q) => q.quarter === '2013-T3')).toBeTruthy();
    expect(body.collecting).toBe(true);
    const prec = body.supply.byDomain.find((d) => d.domain === 'precarite');
    expect(prec.places).toBeGreaterThanOrEqual(7);
    expect(body.supply.byCommune.find((c) => c.commune === '67482').byDomain.precarite).toBeGreaterThanOrEqual(6);
    for (const q of queries) for (const t of PERSONAL_TABLES) expect(q, t).not.toContain(`"${t}"`);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${P}|reviewer-g14obs|1 rue`));
    process.env.ADA_OBSERVATOIRE = 'open'; reset();
    const res = { statusCode: 0, headers: {}, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method: 'GET', query: { format: 'csv' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/^jeu,trimestre,date_gel,signal,domaine,code,commune_insee,commune,valeur,statut\r\n/);
    expect(res.body).toContain('demande,2013-T3,');
    expect(res.body).not.toMatch(new RegExp(`${P}|@`));
  });
});
