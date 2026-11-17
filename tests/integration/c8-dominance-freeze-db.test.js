/**
 * C8 follow-up (owner Paket 4: « solvable C8 engineering must not be left open ») — REAL PostgreSQL, synthetic data only.
 *   K  collusion of contributors: in a commune of exactly 3 organizations, two of them subtract what they know of their own referrals / appointments from
 *      the published cell and obtain the third one's exactly. The p % rule with coalitions (api/_services/territorial-stats.js, `dominated`) masks such a
 *      cell; a cell spread over enough organizations stays published.
 *   F  re-reading a closed quarter: a late answer, an organization losing its verification or a new organization changed the published cells of a past
 *      quarter, so two reads differenced into that one change. Frozen quarters (drizzle/0052, `freezeClosedQuarters`) never move.
 *   J  the freezing job: category A (closed in the beta until named), a run record, idempotent; a frozen row cannot be updated.
 * Real communes (communauté de communes de la Vallée de Villé: Villé, Albé, Breitenbach), dated 2014 (`now` = 2015-02-15): no other suite uses them.
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const NOW = new Date('2015-02-15T10:00:00Z'); const T4 = new Date('2014-11-12T09:00:00Z');
const PLACES = { V: 'Villé', A: 'Albé', B: 'Breitenbach' }; const CP = '67220';
const EPCI = 'Communauté de communes de la Vallée de Villé';
// per commune: referrals received by each organization in 2014-T4 (the TRUE contributions), appointments by each organization
const REFERRALS = { V: [7, 3, 2], A: [7, 6, 6, 6], B: [2, 2, 2, 2] };
const APPOINTMENTS = { V: [6, 0, 0], A: [2, 2, 2, 2], B: [0, 0, 0, 0] };
const org = (k, i) => `c8k-${k}${i}-${TS}`;
const DOSSIER = `c8k-dos-${TS}`; const FROM = `c8k-from-${TS}`; const SVC = `c8k-svc-${TS}`; const PRO = `c8k-pro-${TS}`;

describe.skipIf(!hasDatabase)('C8: collusion rule and frozen quarters (real DB)', () => {
  let db, stats, orgStats, scopeOf; let seq = 0;
  const structure = (id, ville, verification = 'VERIFIED') => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
    VALUES (${id}, ${id}, ${id}, 'association', '1 rue', ${ville}, ${CP}, false, '{}', '{}', '{}', 'actif', ${verification}, NOW(), NOW())`);
  const referral = (to, response = null) => db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
    VALUES (${`c8k-ref-${(seq += 1)}-${TS}`}, ${DOSSIER}, ${FROM}, ${to}, 'COMPLETED', 'HOUSING', ${response}, ${T4}, 'c8k-grant', ${T4}, ${T4}, NOW())`);
  const views = async () => JSON.stringify([await stats.observatoire(db, NOW), await stats.scopedObservatoire(scopeOf(EPCI), db, NOW),
    (await stats.territoryCsv('quarter', db, NOW)).csv, (await stats.scopedTerritoryCsv('quarter', scopeOf(EPCI), db, NOW)).csv,
    (await orgStats.regionalStats({ userId: PRO, structureId: org('A', 0) }, db, NOW)).stats]);
  const commune = (v, name) => v.byCommune.find((r) => r.commune === name);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    stats = await import('../../api/_services/territorial-stats.js'); orgStats = await import('../../api/_services/org-stats.js');
    scopeOf = (await import('../../api/lib/geography/territoryScope.js')).territoryScope;
    await db.execute(sql`DELETE FROM "ObservatoryQuarterSnapshot" WHERE quarter LIKE '2014-T%'`).catch(() => {});   // a database without 0052 has none
    for (const [k, list] of Object.entries(REFERRALS)) for (let i = 0; i < list.length; i += 1) await structure(org(k, i), PLACES[k]);
    await structure(FROM, 'Strasbourg', 'PENDING');
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${DOSSIER}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`);
    for (const [k, list] of Object.entries(REFERRALS)) for (const [i, n] of list.entries()) for (let j = 0; j < n; j += 1) await referral(org(k, i));
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${org('A', 0)}, 'S', 30, NOW())`);
    for (const [k, list] of Object.entries(APPOINTMENTS)) for (const [i, n] of list.entries()) for (let j = 0; j < n; j += 1) await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "beneficiaryName", "startAt", "endAt", status, "updatedAt")
      VALUES (${`c8k-apt-${k}${i}-${j}-${TS}`}, ${org(k, i)}, ${SVC}, 'Personne synthétique', ${T4}, ${new Date(T4.getTime() + 1800000)}, 'done', NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${PRO}, ${PRO + '@example.test'}, 'x', ${org('A', 0)}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ObservatoryQuarterSnapshot" WHERE quarter LIKE '2014-T%'`).catch(() => {});
    await db.execute(sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "serviceId" = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`c8k-%-${TS}`}`);
    await db.execute(sql`DELETE FROM "CronRun" WHERE job = 'observatory-freeze'`);
  });

  it('K two of Villé\'s three organizations cannot recover the third one\'s count: the cell is masked; Albé (spread over four) stays published', async () => {
    const v = await stats.scopedObservatoire(scopeOf(EPCI), db, NOW);
    expect(v.ok, JSON.stringify(v)).toBe(true); expect(v.window.period).toBe('2014-T4');
    // the attack: organizations 2 and 3 know their own 3 + 2 referrals; « published − 5 » would be organization 1's 7
    expect(commune(v, 'Villé').sent, 'Villé 12 = 7 + 3 + 2 (two colluders recover the 7)').toBeNull();
    expect(commune(v, 'Albé').sent).toBe(25);   // 7 + 6 + 6 + 6: any two colluders still face two unknown contributions
    // appointments: Villé's 6 are one organization's (the two others know they had none): masked; Albé's 8 over four organizations: published
    const csv = (await stats.scopedTerritoryCsv('quarter', scopeOf(EPCI), db, NOW)).csv.replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));
    const rdv = (name) => csv.find((l) => l[3] === name)[5];
    expect(rdv('Villé')).toBe(''); expect(rdv('Albé')).toBe('8');
    const reg = await orgStats.regionalStats({ userId: PRO, structureId: org('A', 0) }, db, NOW);
    expect(reg.stats.cities.find((c) => c.name === 'Villé').rdv).toBeNull(); expect(reg.stats.cities.find((c) => c.name === 'Albé').rdv).toBe(8);
    // the preview applies the same rule
    expect(commune(await stats.observatoire(db, NOW), 'Villé').sent).toBeNull();
  });

  it('F re-reading a closed quarter: live, a late answer and a lost verification move published cells; once frozen, nothing moves', async () => {
    const before = await views();
    const mutate = async () => {
      await db.execute(sql`UPDATE "Referral" SET "responseCode" = 'NO_CAPACITY' WHERE id IN (SELECT id FROM "Referral" WHERE "toStructureId" LIKE ${`c8k-A%-${TS}`} ORDER BY id LIMIT 6)`);   // late answers
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'UNVERIFIED' WHERE id = ${org('B', 3)}`);   // Breitenbach loses an organization
    };
    const undo = async () => {
      await db.execute(sql`UPDATE "Referral" SET "responseCode" = NULL WHERE "toStructureId" LIKE ${`c8k-A%-${TS}`}`);
      await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED' WHERE id = ${org('B', 3)}`);
    };
    await mutate();
    expect(await views(), 'live: the same closed quarter read twice differs — the difference isolates the change').not.toBe(before);
    await undo();
    expect(await views()).toBe(before);
    const frozen = await stats.freezeClosedQuarters(db, NOW);
    expect(frozen).toMatchObject({ ok: true, available: true }); expect(frozen.frozen).toContain('2014-T4');
    expect(await views(), 'freezing publishes exactly what was live').toBe(before);
    await mutate();
    await referral(org('V', 1)); await referral(org('V', 1));   // even a referral dated inside the frozen quarter changes nothing
    // every published cell of the quarter is the frozen one; only the CURRENT directory counts of the professional page move (the number of verified
    // organizations today — public through the directory, not a quarterly cell)
    const quarterly = (text) => { const v = JSON.parse(text); delete v[4].activeStructures; delete v[4].structuresInHiddenCommunes; return JSON.stringify(v); };
    expect(quarterly(await views()), 'frozen: a closed quarter reads the same forever').toBe(quarterly(before));
    await undo();
  });

  it('J the freezing job: refused in the beta until named; a run record; idempotent; a frozen row cannot be updated', async () => {
    const { isAllowedInPublicBeta, SCHEDULED_JOBS } = await import('../../api/_utils/public-beta.js');
    expect(SCHEDULED_JOBS['observatory-freeze']).toBe('A');
    expect(isAllowedInPublicBeta('GET', 'cron/observatory-freeze', { ADA_PUBLIC_BETA_RESTRICTED: '1' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'cron/observatory-freeze', { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_JOBS: 'observatory-freeze' })).toBe(true);
    const handler = (await import('../../api/_handlers/cron/observatory-freeze.js')).default;
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} }, res, { now: NOW });
    expect(res.statusCode).toBe(200); expect(res.body.frozen, 'already frozen: nothing new').toEqual([]); expect(res.body.alreadyFrozen).toContain('2014-T4');
    const [run] = (await db.execute(sql`SELECT status, metrics FROM "CronRun" WHERE job = 'observatory-freeze' ORDER BY "startedAt" DESC LIMIT 1`)).rows;
    expect(run.status).toBe('success'); expect(JSON.stringify(run.metrics)).not.toMatch(/c8k-|Villé|HOUSING/);
    const anon = { ...res, statusCode: 200 }; await handler({ method: 'GET', headers: {}, query: {} }, anon); expect(anon.statusCode).toBe(401);
    await expect(db.execute(sql`UPDATE "ObservatoryQuarterSnapshot" SET blocks = '[]'::jsonb WHERE quarter = '2014-T4'`)).rejects.toThrow();
    const [row] = (await db.execute(sql`SELECT blocks::text AS b, rules FROM "ObservatoryQuarterSnapshot" WHERE quarter = '2014-T4'`)).rows;
    expect(row.b).not.toMatch(/c8k-/);   // published cells, commune codes and names only: no organization id, no raw count
    expect(row.rules).toMatchObject({ kMin: 5, coalition: 2, pPercent: 20 });
  });
});
