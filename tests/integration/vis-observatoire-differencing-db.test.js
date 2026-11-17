/**
 * Visibility audit (2026-11) — REAL PostgreSQL, synthetic data only. The differencing attacks an institutional partner or a professional could run on the two
 * observatoires, performed for real on a dataset whose true counts the test knows:
 *   P1  institution/observatoire: « a published aggregate minus the published cells of a table » must never be the sum of that table's masked cells (the trend's
 *       last quarter was the TRUE total); and a change inside a masked cell must change NOTHING that is published (JSON and CSV byte-identical);
 *   (b) OUT_OF_SCOPE answers are their own indicator, never an unmet need;
 *   P4  pro/regional-stats: complete calendar quarters only — an appointment of the running period between two polls changes nothing published.
 * The referrals are dated in 2018-T4 (`now` = 2019-02-15): no other suite writes there, so the true counts hold on a shared database too.
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const NOW = new Date('2019-02-15T10:00:00Z'); const SENT = new Date('2018-11-10T09:00:00Z');
// C8: four real communes of ONE EPCI (Hanau-La Petite Pierre) — the statistics place an organization by INSEE commune and publish one table per EPCI
const COMMUNES = ['Bischholtz', 'Bosselshausen', 'Bouxwiller', 'Buswiller']; const POSTAL = ['67340', '67330', '67330', '67350'];
const org = (c, i) => `visd-${c}${i}-${TS}`;
const DOSSIER = `visd-dos-${TS}`; const SVC = `visd-svc-${TS}`; const PRO = `visd-pro-${TS}`; const FROM = `visd-from-${TS}`;
// [commune index, need, response, how many] — the TRUE counts (never published as such)
const FIXTURE = [
  [0, 'HOUSING', 'NO_CAPACITY', 2], [0, 'HOUSING', 'OUT_OF_SCOPE', 1], [0, 'HOUSING', null, 6],   // A: 9
  [1, 'HOUSING', 'OUT_OF_SCOPE', 5], [1, 'HOUSING', null, 1], [1, 'FOOD_AID', null, 3],          // B: 9
  [2, 'HEALTH', 'NO_CAPACITY', 6], [2, 'HEALTH', 'OUT_OF_SCOPE', 2],                              // C: 8
  [3, 'OTHER', null, 2],                                                                          // D: 2 (a small cell)
];
const TRUE = { sent: 28, unmet: 8, outOfScope: 8, need: { HOUSING: 15, FOOD_AID: 3, HEALTH: 8, OTHER: 2 }, commune: [9, 9, 8, 2] };
const MEASURES = ['sent', 'unmet', 'outOfScope'];
const pub = (rows, k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);

describe.skipIf(!hasDatabase)('visibility audit: differencing attacks on the observatoires (real DB)', () => {
  let db, stats, orgStats; let seq = 0; const turn = {};   // C8 collusion rule: referrals spread over the commune's four organizations in turn
  const referral = (ci, need, response) => db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
    VALUES (${`visd-ref-${(seq += 1)}-${TS}`}, ${DOSSIER}, ${FROM}, ${org(ci, (turn[ci] = (turn[ci] ?? -1) + 1) % 4)}, 'COMPLETED', ${need}, ${response}, ${SENT}, 'visd-grant', ${SENT}, ${SENT}, NOW())`);
  const csvRows = (csv) => csv.replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    stats = await import('../../api/_services/territorial-stats.js'); orgStats = await import('../../api/_services/org-stats.js');
    const structure = (id, ville, verification, cp = '67000') => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${id}, ${id}, 'association', '1 rue', ${ville}, ${cp}, false, '{}', '{}', '{}', 'actif', ${verification}, NOW(), NOW())`);
    for (let c = 0; c < COMMUNES.length; c += 1) for (let i = 0; i < 4; i += 1) await structure(org(c, i), COMMUNES[c], 'VERIFIED', POSTAL[c]);
    await structure(FROM, `VisDiffFrom-${TS}`, 'PENDING');   // the sender: not verified, so its commune is never shown
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${DOSSIER}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`);
    for (const [ci, need, response, count] of FIXTURE) for (let i = 0; i < count; i += 1) await referral(ci, need, response);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${org(0, 0)}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${PRO}, ${PRO + '@example.test'}, 'x', ${org(0, 0)}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "serviceId" = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`visd-%-${TS}`}`);
  });

  it('P1: no published aggregate minus the published cells of a table gives the sum of its masked cells (observatoire and CSV)', async () => {
    const obs = await stats.observatoire(db, NOW);
    expect(obs.window.period).toBe('2018-T4');
    const out = await stats.territoryCsv('quarter', db, NOW); expect(out.ok).toBe(true);
    const rows = csvRows(out.csv); const head = rows[0]; const total = rows[rows.length - 1]; const body = rows.slice(1, -1);
    const col = { sent: head.indexOf('orientations_recues'), unmet: head.indexOf('besoins_non_couverts'), outOfScope: head.indexOf('orientations_hors_perimetre') };
    for (const m of MEASURES) {
      expect(col[m], m).toBeGreaterThan(0);
      // everything a reader holds that could stand for « the total »
      const aggregates = [obs.trend[obs.trend.length - 1][m], obs.totals[m], pub(obs.byNeed, m), pub(obs.byCommune, m), Number(total[col[m]] || 0), body.reduce((n, r) => n + Number(r[col[m]] || 0), 0)].map((v) => v ?? 0);
      for (const [name, table] of [['byNeed', obs.byNeed], ['byCommune', obs.byCommune]]) {
        const maskedSum = TRUE[m] - pub(table, m);   // the secret: what the masked cells of this table add up to
        expect(maskedSum, `${name}.${m} has masked cells in this fixture`).toBeGreaterThan(0);
        for (const a of aggregates) expect(a - pub(table, m), `${m}: an aggregate (${a}) minus the published cells of ${name} is the sum of its masked cells`).not.toBe(maskedSum);
        expect(table.filter((r) => r[m] === null).length, `${name}.${m}: never exactly one masked cell`).not.toBe(1);
      }
      // no published aggregate is the true total
      for (const a of aggregates) expect(a, `${m}: the true total is published`).not.toBe(TRUE[m]);
    }
    // the small cells themselves: masked in both tables, in the observatoire and in the export alike
    expect(obs.byNeed.find((r) => r.need === 'OTHER').sent).toBeNull(); expect(obs.byNeed.find((r) => r.need === 'FOOD_AID').sent).toBeNull();
    const mine = obs.byCommune.filter((r) => COMMUNES.includes(r.commune));
    expect(mine.map((r) => r.commune)).toEqual(COMMUNES); expect(mine[3].sent).toBeNull();
    for (const r of mine) {
      const line = body.find((l) => l[3] === r.commune);
      expect(MEASURES.map((m) => line[col[m]]), 'the export publishes the observatoire\'s own cells').toEqual(MEASURES.map((m) => (r[m] === null ? '' : String(r[m]))));
      expect(line[4]).toBe('4');
    }
    expect(JSON.stringify(obs)).not.toMatch(/visd-|@example\.test/);
    for (const key of ['besoinsNonCouverts', 'horsPerimetre', 'limites', 'totaux', 'periodes']) expect(obs.methodology[key], key).toBeTruthy();
    expect(obs.methodology.totaux).toMatch(/Aucun total réel/);
  });

  it('(b) an OUT_OF_SCOPE answer is an « orientation hors périmètre », never an unmet need', async () => {
    const obs = await stats.observatoire(db, NOW);
    const housing = obs.byNeed.find((r) => r.need === 'HOUSING');
    expect(housing.outOfScope, '6 mis-orientations: published as their own indicator').toBe(6);
    expect(housing.unmet, '2 « no capacity » only (8 with the out-of-scope answers counted as unmet): masked').toBeNull();
    expect(obs.byNeed.find((r) => r.need === 'HEALTH').unmet).toBe(6);
    expect(obs.methodology.besoinsNonCouverts).not.toMatch(/hors de notre champ/); expect(obs.methodology.horsPerimetre).toMatch(/hors de notre champ/);
  });

  it('P1: a change inside a masked cell changes nothing that is published (JSON and CSV byte-identical)', async () => {
    const before = await stats.observatoire(db, NOW); const csvBefore = await stats.territoryCsv('quarter', db, NOW);
    await referral(3, 'OTHER', null);   // the small commune D and the small need OTHER: 2 -> 3, the true total 28 -> 29
    const after = await stats.observatoire(db, NOW); const csvAfter = await stats.territoryCsv('quarter', db, NOW);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(csvAfter.sha256).toBe(csvBefore.sha256);
  });

  it('P4: the professional observatoire publishes complete quarters only — an appointment of the running period between two polls changes nothing', async () => {
    const ctx = { userId: PRO, structureId: org(0, 0) };
    let n = 0;   // C8 collusion rule: the appointments are spread over commune A's four organizations
    const apt = (id, startAt) => db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdAt", "updatedAt")
      VALUES (${id}, ${org(0, (n += 1) % 4)}, ${SVC}, ${startAt}, ${new Date(startAt.getTime() + 60_000)}, 'confirmed', 'v1:sealed', NOW(), NOW())`);
    const last = stats.periodWindow('quarter');
    for (let i = 0; i < 7; i += 1) await apt(`visd-q${i}-${TS}`, new Date(last.start.getTime() + (20 + i) * 86400000));
    const first = await orgStats.regionalStats(ctx, db);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.period.label).toBe(last.label);
    expect(first.stats.cities.find((c) => c.name === COMMUNES[0]).rdv, 'the 7 appointments of the last complete quarter').toBe(7);
    expect(first.stats.trend.map((t) => t.quarter)).toEqual(stats.lastQuarters().map((q) => q.label));
    expect(first.stats.trend[3].value, 'the trend adds published commune cells only').toBe(first.stats.appointmentsLastQuarter);
    expect(first.stats).not.toHaveProperty('totalCitizensHelped'); expect(first.stats).not.toHaveProperty('appointmentsThisMonth');
    expect(first.stats).toHaveProperty('peopleWithAppointment');
    // the attack: six appointments happen « today », the attacker polls again and subtracts
    for (let i = 0; i < 6; i += 1) await apt(`visd-now${i}-${TS}`, new Date());
    const second = await orgStats.regionalStats(ctx, db);
    expect(second.stats, 'two polls differenced into the running period\'s appointments of a commune').toEqual(first.stats);
  });
});
