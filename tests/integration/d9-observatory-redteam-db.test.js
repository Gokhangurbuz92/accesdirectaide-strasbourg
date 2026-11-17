/**
 * FA-D9 red team of the observatory (reference 09) — REAL PostgreSQL, synthetic data only, attacks run by an adversary who knows the true counts of
 * this fixture. Each test is one attack; the expectation is what a SAFE system answers (the attack fails). Already covered elsewhere and not repeated:
 * single base / preview − CSV (c8-observatory-single-base-db), collusion of contributors (c8-dominance-freeze-db K, d8-observatory-entity-db), nested
 * territories (g1-territory-scope-db), marginal bounds (tests/unit/c8-marginal-bounds), masked-cell sums (vis-observatoire-differencing-db).
 *   R1  repeated reads of the same view                       → byte-identical (nothing to difference)
 *   R2  groups: preview vs EPCI vs département vs commune view → the same commune cell everywhere; table by need never narrower than « masked »
 *   R3  time windows: months / years / free periods             → refused; the four quarters never overlap
 *   R4  frozen snapshot vs live recompute (Production mode)    → WEAKNESS found: with the freezing job closed (as in Production today) every closed
 *       quarter was recomputed live on each read, so two reads around one late answer / one organisation losing its verification isolated that change.
 *       Fixed: in Production (VERCEL_ENV=production, or OBS_PUBLISH_FROZEN_ONLY) a closed quarter is published only once frozen; before, it is WITHHELD.
 *   R5  exact zeros                                            → never published (a shown commune without referral reads « < 5 », not 0)
 *   R6  cohorts / unique characteristics                       → no dimension but need × commune × quarter exists in any response
 *   R7  metric names                                           → every published key maps to one defined metric; the CSV no longer says « besoins non couverts »
 * Real communes of the communauté de communes du Pays de Barr (Barr, Andlau, Epfig), dated 2010 (`now` = 2011-02-15): no other suite uses them.
 * Skipped without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const NOW = new Date('2011-02-15T10:00:00Z'); const T4 = new Date('2010-11-09T09:00:00Z'); const T3 = new Date('2010-08-10T09:00:00Z');
const PLACES = { B: ['Barr', '67140'], A: ['Andlau', '67140'], E: ['Epfig', '67680'] };
const EPCI = 'Communauté de communes du Pays de Barr';
const ORGS = { B: 4, A: 5, E: 4 };   // verified organisations per commune
const org = (k, i) => `d9-${k}${i}-${TS}`;
const DOSSIER = `d9-dos-${TS}`; const FROM = `d9-from-${TS}`; const SVC = `d9-svc-${TS}`; const PRO = `d9-pro-${TS}`;
// [commune, need, response, how many, when] — every commune's referrals spread over its organizations in turn (the collusion rule does not mask them);
// Andlau: 20 referrals, 4 per organisation — the secret of R4 is one organisation's 4
const FIXTURE = [
  ['B', 'HOUSING', null, 8, T4], ['B', 'HEALTH', null, 8, T4],
  ['A', 'HOUSING', null, 10, T4], ['A', 'HOUSING', 'NO_CAPACITY', 10, T4],
  ['E', 'HEALTH', null, 8, T4],
  ['B', 'HOUSING', null, 8, T3],
];
const MEASURES = ['sent', 'unmet', 'outOfScope'];
const NAMES = Object.values(PLACES).map((p) => p[0]);

describe.skipIf(!hasDatabase)('FA-D9: observatory red team (real DB)', () => {
  let db, stats, orgStats, scopeOf; let seq = 0; const turn = {};
  const saved = { frozenOnly: process.env.OBS_PUBLISH_FROZEN_ONLY };
  const target = (k) => org(k, (turn[k] = (turn[k] ?? -1) + 1) % ORGS[k]);
  const referral = (k, need, response, when) => db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
    VALUES (${`d9-ref-${(seq += 1)}-${TS}`}, ${DOSSIER}, ${FROM}, ${target(k)}, 'COMPLETED', ${need}, ${response}, ${when}, 'd9-grant', ${when}, ${when}, NOW())`);
  const scoped = (label) => stats.scopedObservatoire(scopeOf(label), db, NOW);
  const mine = (rows) => rows.filter((r) => NAMES.includes(r.commune));
  const regional = () => orgStats.regionalStats({ userId: PRO, structureId: org('B', 0) }, db, NOW);
  // the public directory count (verified organisations, shown on the public directory anyway) is left out of the comparison of R4
  const cellsOnly = (v) => v.replace(/"(activeStructures|structuresInHiddenCommunes)":\d+,?/g, '');
  const everyView = async () => JSON.stringify([await stats.observatoire(db, NOW), await scoped(EPCI), await scoped('Bas-Rhin'),
    await stats.territoryCsv('quarter', db, NOW), await stats.scopedTerritoryCsv('quarter', scopeOf(EPCI), db, NOW), (await regional()).stats]);
  const clearSnapshots = () => db.execute(sql`DELETE FROM "ObservatoryQuarterSnapshot" WHERE quarter LIKE '2010-T%'`).catch(() => {});

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    stats = await import('../../api/_services/territorial-stats.js'); orgStats = await import('../../api/_services/org-stats.js');
    scopeOf = (await import('../../api/lib/geography/territoryScope.js')).territoryScope;
    await clearSnapshots();
    const structure = (id, ville, cp, verification) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${id}, ${id}, 'association', '1 rue', ${ville}, ${cp}, false, '{}', '{}', '{}', 'actif', ${verification}, NOW(), NOW())`);
    for (const k of Object.keys(PLACES)) for (let i = 0; i < ORGS[k]; i += 1) await structure(org(k, i), PLACES[k][0], PLACES[k][1], 'VERIFIED');
    await structure(FROM, 'Strasbourg', '67000', 'PENDING');
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${DOSSIER}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`);
    for (const [k, n, response, count, when] of FIXTURE) for (let i = 0; i < count; i += 1) await referral(k, n, response, when);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${org('B', 0)}, 'S', 30, NOW())`);
    for (const k of Object.keys(PLACES)) for (let i = 0; i < 8; i += 1) await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "beneficiaryName", "startAt", "endAt", status, "updatedAt")
      VALUES (${`d9-apt-${k}-${i}-${TS}`}, ${org(k, i % 4)}, ${SVC}, 'Personne synthétique', ${T4}, ${new Date(T4.getTime() + 1800000)}, 'done', NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${PRO}, ${PRO + '@example.test'}, 'x', ${org('B', 0)}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
  }, 120000);

  afterEach(() => { if (saved.frozenOnly === undefined) delete process.env.OBS_PUBLISH_FROZEN_ONLY; else process.env.OBS_PUBLISH_FROZEN_ONLY = saved.frozenOnly; });

  afterAll(async () => {
    if (!db) return;
    await clearSnapshots();
    await db.execute(sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "serviceId" = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`d9-%-${TS}`}`);
  });

  it('R1 repeated reads of every view are byte-identical (nothing to difference)', async () => {
    const a = await everyView(); const b = await everyView(); const c = await everyView();
    expect(b).toBe(a); expect(c).toBe(a);
  });

  it('R2 groups: the preview, the EPCI, the département and a commune-sized view publish the same commune cells; no table by need below its block', async () => {
    const views = { preview: await stats.observatoire(db, NOW), epci: await scoped(EPCI), dep: await scoped('Bas-Rhin') };
    for (const name of NAMES) {
      const cells = Object.values(views).map((v) => JSON.stringify(v.byCommune.find((r) => r.commune === name)));
      expect(new Set(cells).size, name).toBe(1);
    }
    // the larger view minus the smaller one, need by need: 0 or a published value (never a masked one)
    const cell = (v, n, m) => v.byNeed.find((r) => r.need === n)?.[m] ?? 0;
    for (const [big, small] of [[views.preview, views.dep], [views.dep, views.epci]]) for (const n of new Set(big.byNeed.map((r) => r.need))) for (const m of MEASURES) {
      const d = cell(big, n, m) - cell(small, n, m); expect(d === 0 || d >= 5, `${n} ${m}: ${d}`).toBe(true);
    }
    // a territory smaller than its EPCI (one commune) gets no table by need — the EPCI's table minus it would be the rest
    const communeScope = { ok: true, kind: 'commune', code: '67021', communes: new Set(['67021']) };
    const one = await stats.scopedObservatoire(communeScope, db, NOW);
    expect(one.byNeed).toEqual([]); expect(one.scope.byNeed).toBe('NONE');
  });

  it('R3 time windows: no month, year or free period; four consecutive non-overlapping quarters', async () => {
    for (const p of ['month', 'year', '2010', '2010-01-01/2010-12-31', 'week']) {
      expect((await stats.territoryCsv(p, db, NOW)).status, p).toBe(400);
      expect((await stats.scopedTerritoryCsv(p, scopeOf(EPCI), db, NOW)).status, p).toBe(400);
    }
    const v = await scoped(EPCI);
    expect(v.trend.map((t) => t.quarter)).toEqual(['2010-T1', '2010-T2', '2010-T3', '2010-T4']);
  });

  it('R4-LAB (why): live, two reads around one organisation losing its verification give that organisation\'s exact count (4, a « < 5 » value)', async () => {
    delete process.env.OBS_PUBLISH_FROZEN_ONLY; await clearSnapshots();
    const andlau = async () => (await scoped(EPCI)).byCommune.find((r) => r.commune === 'Andlau').sent;
    const before = await andlau();
    await db.execute(sql`UPDATE "Structure" SET verification_status = 'PENDING' WHERE id = ${org('A', 4)}`);
    try {
      const after = await andlau();
      expect([before, after]).toEqual([20, 16]);   // 20 − 16 = 4: the attack succeeds wherever closed quarters are recomputed live (the LAB, and Production before FA-D9)
    } finally { await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED' WHERE id = ${org('A', 4)}`); }
  });

  it('R4 frozen vs live (Production mode): two reads around a late answer and a lost verification move nothing; a closed quarter is published only once frozen', async () => {
    process.env.OBS_PUBLISH_FROZEN_ONLY = '1';
    await clearSnapshots();
    const before = cellsOnly(await everyView());
    // the change an attacker wants to isolate: one late « no capacity » answer in Barr, one Andlau organisation losing its verification
    await db.execute(sql`UPDATE "Referral" SET "responseCode" = 'NO_CAPACITY' WHERE id = (SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "toStructureId" = ${org('B', 1)} AND "responseCode" IS NULL AND "sentAt" = ${T4} LIMIT 1)`);
    await db.execute(sql`UPDATE "Structure" SET verification_status = 'PENDING' WHERE id = ${org('A', 4)}`);
    try {
      const after = cellsOnly(await everyView());
      expect(after, 'live recompute of a closed quarter isolates one change').toBe(before);
      // not frozen yet: nothing of the closed quarters is published, and the view says why
      const v = await scoped(EPCI);
      expect(v.window.withheld).toBe(true); expect(v.trend.every((t) => t.withheld === true && t.sent === null)).toBe(true);
      expect(mine(v.byCommune)).toEqual([]);
      expect((await stats.scopedTerritoryCsv('quarter', scopeOf(EPCI), db, NOW)).code).toBe('QUARTER_NOT_FROZEN');
      // frozen once: published, and later changes move nothing
      expect((await stats.freezeClosedQuarters(db, NOW)).frozen).toContain('2010-T4');
      const frozen = cellsOnly(await everyView());
      expect((await scoped(EPCI)).window.withheld).toBeUndefined();
      expect(mine((await scoped(EPCI)).byCommune).map((r) => [r.commune, r.sent])).toEqual([['Andlau', 16], ['Barr', 16], ['Epfig', 8]]);
      expect((await regional()).stats.cities.every((c) => c.agents === null), 'active members are never frozen: not published in this mode').toBe(true);
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED' WHERE id = ${org('A', 4)}`);
      expect(cellsOnly(await everyView())).toBe(frozen);
    } finally {
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED' WHERE id = ${org('A', 4)}`);
      await clearSnapshots();
    }
  });

  it('R5 exact zeros are never published: a shown commune without any « no capacity » answer reads « < 5 », not 0', async () => {
    const v = await scoped(EPCI);
    const epfig = v.byCommune.find((r) => r.commune === 'Epfig');
    expect(epfig.unmet).toBeNull(); expect(epfig.outOfScope).toBeNull();
    for (const r of [...v.byNeed, ...v.byCommune, ...v.trend, v.totals]) for (const m of MEASURES) expect(r[m] === null || r[m] >= 5, `${JSON.stringify(r)}`).toBe(true);
    const csv = (await stats.scopedTerritoryCsv('quarter', scopeOf(EPCI), db, NOW)).csv;
    expect(csv.split('\r\n').filter((l) => NAMES.some((n) => l.includes(n))).every((l) => !/,0(,|$)/.test(l.split(',').slice(5).join(',')))).toBe(true);
  });

  it('R6 cohorts / unique characteristics: no dimension other than need × commune × quarter is published', async () => {
    const v = await scoped(EPCI);
    for (const r of v.byNeed) expect(Object.keys(r).sort()).toEqual(['need', 'outOfScope', 'sent', 'unmet']);
    for (const r of v.byCommune) expect(Object.keys(r).sort()).toEqual(['commune', 'outOfScope', 'sent', 'unmet']);
    expect(JSON.stringify(v)).not.toMatch(/d9-|@example\.test|age|sexe|gender|nationalit|handicap/i);
    const reg = (await regional()).stats;
    for (const c of reg.cities) expect(Object.keys(c).sort()).toEqual(['agents', 'city', 'id', 'name', 'orgs', 'rdv', 'status']);
  });

  it('R7 every published figure names its metric; « besoins non couverts » is gone from the export (a refusal for capacity is not an unmet need)', async () => {
    const v = await scoped(EPCI);
    expect(v.metrics.unmet.metric).toBe('referral_declined_no_capacity'); expect(v.metrics.sent.metric).toBe('referral_sent');
    const head = (await stats.scopedTerritoryCsv('quarter', scopeOf(EPCI), db, NOW)).csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(head).not.toMatch(/besoins_non_couverts/); expect(head).toMatch(/orientations_refusees_capacite/);
    expect(v.methodology.nonRecours).toMatch(/ne mesurent ni le non-recours/);
    const reg = await regional();
    expect(reg.metrics.peopleWithAppointment.unit).toBe('ACCOUNT');
  });
});
