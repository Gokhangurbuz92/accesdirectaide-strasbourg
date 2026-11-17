/**
 * C8 (owner Paket 4: engineering fix in the LAB, publication deferred) — REAL PostgreSQL, synthetic data only. The differencing attacks that remained after
 * G1, run for real on a dataset whose true counts the test knows:
 *   D1  administrators' UNSCOPED preview − an institution's SCOPED view: the preview put organizations in communes by the NAME typed in the address, the
 *       scoped views by the INSEE commune (name AND postal code). An organization whose address is « Sélestat, 68000 » counted in the preview's Sélestat and
 *       in no scoped view: preview cell − scoped cell = that ONE organization's referrals (3 here, below the threshold, and the 3-organization rule broken);
 *   D2  professional regional observatoire − institutional CSV: the same appointments per commune, published over the two populations: difference = the
 *       unlocated organization's appointments (2 here);
 *   D3  every view a single actor can reach is a restriction of ONE suppressed base (located verified organizations → shown communes → EPCI blocks,
 *       published once per block): same commune ⇒ same cell everywhere; table by need of a larger view − a smaller one ∈ {0} ∪ [5, ∞);
 *       totals and trends are sums of published cells (nothing to subtract them from).
 * Real communes are needed (the base is the INSEE reference): the communauté de communes de Sélestat (Sélestat, Châtenois, Scherwiller) and Rosheim's,
 * which no other suite uses. Dated 2015 (`now` = 2016-02-15): no other suite writes there. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const NOW = new Date('2016-02-15T10:00:00Z'); const T4 = new Date('2015-11-10T09:00:00Z'); const T3 = new Date('2015-08-12T09:00:00Z');
const PLACES = { S: ['Sélestat', '67600'], C: ['Châtenois', '67730'], W: ['Scherwiller', '67750'], R: ['Rosheim', '67560'] };
const NAMES = { S: 'Sélestat', C: 'Châtenois', W: 'Scherwiller', R: 'Rosheim' };
const org = (k, i) => `c8-${k}${i}-${TS}`;
const LOST = `c8-lost-${TS}`;   // verified, address « Sélestat, 68000 »: the name and the postal code name no single commune → located nowhere
const DOSSIER = `c8-dos-${TS}`; const FROM = `c8-from-${TS}`; const SVC = `c8-svc-${TS}`; const PRO = `c8-pro-${TS}`;
// [commune key or LOST, need, response, how many, when] — the TRUE counts
const FIXTURE = [
  ['S', 'HOUSING', null, 7, T4], ['S', 'HEALTH', null, 5, T4],              // Sélestat 12
  ['C', 'HOUSING', null, 5, T4], ['C', 'HEALTH', 'NO_CAPACITY', 5, T4],    // Châtenois 10 (5 unmet)
  ['W', 'HOUSING', null, 6, T4],                                             // Scherwiller 6
  ['R', 'HOUSING', null, 9, T4],                                             // Rosheim 9 (another block)
  ['LOST', 'HOUSING', null, 3, T4],                                          // the unlocated organization: 3 — its secret
  ['S', 'HOUSING', null, 6, T3], ['LOST', 'HOUSING', null, 2, T3],           // the quarter before: the trend
];
const APPOINTMENTS = { S: 8, C: 6, W: 5, R: 7, LOST: 2 };
const MEASURES = ['sent', 'unmet', 'outOfScope'];

describe.skipIf(!hasDatabase)('C8: one suppressed base for every view (real DB)', () => {
  let db, stats, orgStats, scopeOf; let seq = 0;
  const turn = {};   // C8 collusion rule: each commune's referrals and appointments are spread over its FOUR organizations in turn
  const target = (k) => (k === 'LOST' ? LOST : org(k, (turn[k] = (turn[k] ?? -1) + 1) % 4));
  const referral = (k, need, response, when) => db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
    VALUES (${`c8-ref-${(seq += 1)}-${TS}`}, ${DOSSIER}, ${FROM}, ${target(k)}, 'COMPLETED', ${need}, ${response}, ${when}, 'c8-grant', ${when}, ${when}, NOW())`);
  const mine = (rows, key = 'commune') => rows.filter((r) => Object.values(NAMES).includes(r[key]));
  const scoped = (label) => stats.scopedObservatoire(scopeOf(label), db, NOW);
  const csvRows = (csv) => csv.replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));
  const regional = () => orgStats.regionalStats({ userId: PRO, structureId: org('S', 0) }, db, NOW);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    stats = await import('../../api/_services/territorial-stats.js'); orgStats = await import('../../api/_services/org-stats.js');
    scopeOf = (await import('../../api/lib/geography/territoryScope.js')).territoryScope;
    const structure = (id, ville, cp, verification) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${id}, ${id}, 'association', '1 rue', ${ville}, ${cp}, false, '{}', '{}', '{}', 'actif', ${verification}, NOW(), NOW())`);
    for (const k of Object.keys(PLACES)) for (let i = 0; i < 4; i += 1) await structure(org(k, i), PLACES[k][0], PLACES[k][1], 'VERIFIED');
    await structure(LOST, 'Sélestat', '68000', 'VERIFIED');
    await structure(FROM, 'Strasbourg', '67000', 'PENDING');
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${DOSSIER}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`);
    for (const [k, n, response, count, when] of FIXTURE) for (let i = 0; i < count; i += 1) await referral(k, n, response, when);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${org('S', 0)}, 'S', 30, NOW())`);
    for (const [k, count] of Object.entries(APPOINTMENTS)) for (let i = 0; i < count; i += 1) await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "beneficiaryName", "startAt", "endAt", status, "updatedAt")
      VALUES (${`c8-apt-${k}-${i}-${TS}`}, ${target(k)}, ${SVC}, 'Personne synthétique', ${T4}, ${new Date(T4.getTime() + 1800000)}, 'done', NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${PRO}, ${PRO + '@example.test'}, 'x', ${org('S', 0)}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "serviceId" = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`c8-%-${TS}`}`);
  });

  it('D1 administrators\' preview − institutional view: the same commune has the SAME cell in both (the unlocated organization\'s 3 referrals are in neither)', async () => {
    const preview = await stats.observatoire(db, NOW); const epci = await scoped('Communauté de communes de Sélestat'); const dep = await scoped('Bas-Rhin');
    expect(preview.window.period).toBe('2015-T4'); expect(epci.ok, JSON.stringify(epci)).toBe(true);
    for (const view of [epci, dep]) for (const r of mine(view.byCommune)) {
      const p = preview.byCommune.find((x) => x.commune === r.commune);
      expect(p, `${r.commune} is in the preview`).toBeTruthy();
      for (const m of MEASURES) expect((p[m] ?? 0) - (r[m] ?? 0), `preview − ${view.scope.kind}, ${r.commune}.${m}`).toBe(0);
    }
    expect(preview.byCommune.find((x) => x.commune === 'Sélestat').sent).toBe(12);   // the true located count; 15 before (the unlocated organization's 3 added)
    // the table by need: preview − département = the PUBLISHED cells of blocks outside the département (none here) — never a count below 5
    const cell = (v, n, m) => v.byNeed.find((r) => r.need === n)?.[m] ?? 0;
    for (const n of new Set(preview.byNeed.map((r) => r.need))) for (const m of MEASURES) {
      const d = cell(preview, n, m) - cell(dep, n, m);
      expect(d === 0 || d >= 5, `preview − département, ${n}.${m} = ${d}`).toBe(true);
    }
    // totals and trend: sums of the published cells only. 2015-T3: Sélestat's 6 HOUSING referrals are its block's whole table by need beside two empty
    // (masked) communes, so they are masked (alignColumns) — before C8 the preview published HOUSING 8 there (6 + the unlocated organization's 2)
    const sum = (rows, m) => { const t = rows.reduce((x, r) => x + (r[m] ?? 0), 0); return t >= 5 ? t : null; };
    for (const m of MEASURES) { expect(preview.totals[m]).toBe(sum(preview.byNeed, m)); expect(preview.trend[3][m]).toBe(preview.totals[m]); }
    expect(preview.trend.find((t) => t.quarter === '2015-T3').sent).toBeNull();
    expect(preview.trend.find((t) => t.quarter === '2015-T3')).toEqual(dep.trend.find((t) => t.quarter === '2015-T3'));
    expect(JSON.stringify(preview)).not.toMatch(/c8-|@example\.test/);
  });

  it('D2 professional observatoire − institutional CSV: the same appointments per commune (the unlocated organization\'s 2 are in neither) and the same organizations', async () => {
    const reg = await regional(); expect(reg.ok, JSON.stringify(reg)).toBe(true);
    const csv = await stats.scopedTerritoryCsv('quarter', scopeOf('Bas-Rhin'), db, NOW); expect(csv.ok).toBe(true);
    const rows = csvRows(csv.csv); const head = rows[0];
    for (const name of Object.values(NAMES)) {
      const city = reg.stats.cities.find((c) => c.name === name); const line = rows.find((l) => l[3] === name);
      expect(city, name).toBeTruthy(); expect(line, name).toBeTruthy();
      expect(city.rdv === null ? '' : String(city.rdv), `regional − CSV rendez_vous, ${name}`).toBe(line[head.indexOf('rendez_vous')]);
      expect(String(city.orgs), `organisations, ${name}`).toBe(line[head.indexOf('organisations_verifiees')]);
    }
    expect(reg.stats.cities.find((c) => c.name === 'Sélestat').rdv).toBe(8);   // 10 before (the unlocated organization's 2 added)
    // the professional trend and totals add published commune cells only
    const published = reg.stats.cities.reduce((n, c) => n + (c.rdv ?? 0), 0);
    expect(reg.stats.trend[3].value).toBe(published >= 5 ? published : null); expect(reg.stats.appointmentsLastQuarter).toBe(reg.stats.trend[3].value);
  });

  it('D3 one base: the administrators\' preview is exactly the union of what the institutional views of its blocks read; a change inside a masked cell moves nothing anywhere', async () => {
    const preview = await stats.observatoire(db, NOW);
    const parts = [await scoped('Communauté de communes de Sélestat'), await scoped('Communauté de communes des Portes de Rosheim')];
    for (const p of parts) expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(mine(preview.byCommune)).toEqual(parts.flatMap((p) => p.byCommune).sort((a, b) => a.commune.localeCompare(b.commune, 'fr')));
    // the unlocated organization gets 2 more referrals and 1 more appointment (its secret moves): nothing published by any view moves
    const snapshot = async () => JSON.stringify([await stats.observatoire(db, NOW), await scoped('Bas-Rhin'), (await stats.territoryCsv('quarter', db, NOW)).sha256,
      (await stats.scopedTerritoryCsv('quarter', scopeOf('Bas-Rhin'), db, NOW)).sha256, (await regional()).stats]);
    const before = await snapshot();
    await referral('LOST', 'HOUSING', null, T4); await referral('LOST', 'HEALTH', null, T4);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "beneficiaryName", "startAt", "endAt", status, "updatedAt")
      VALUES (${`c8-apt-extra-${TS}`}, ${LOST}, ${SVC}, 'Personne synthétique', ${T4}, ${new Date(T4.getTime() + 1800000)}, 'done', NOW())`);
    expect(await snapshot()).toBe(before);
  });
});
