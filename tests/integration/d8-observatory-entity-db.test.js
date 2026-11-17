/**
 * D8 (owner 17/11: organisation ≠ establishment ≠ service) — the observatory's disclosure control counts ORGANISATIONS (C8: « at least 3 organisations » per
 * commune, the p % rule with a coalition of 2), but it counted Structure ROWS. One organisation often has several rows: the establishments of one legal
 * entity (one SIREN: the agencies of France Travail, the centres médico-sociaux of the Eurométropole in the city's open data), or a record the duplicate
 * register put aside as « the same organisation » as another. That organisation knows the share of each of its rows, so it is one contributor, and the rules
 * were satisfied by one organisation alone. Now the contributor is the legal entity when the record carries a SIRET (its SIREN), the kept record for a
 * record put aside as a duplicate, else the record itself (a record without identifier stays its own contributor: never looser than before).
 * REAL PostgreSQL, synthetic data, real communes no other suite uses (Lauterbourg, Ingwiller, Wissembourg), quarter 2012-T4 (`now` = 2013-02-15).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const NOW = new Date('2013-02-15T10:00:00Z'); const T4 = new Date('2012-11-12T09:00:00Z');
const SIREN = { X: `9${String(TS).slice(-8)}`, Z: `8${String(TS).slice(-8)}` };
const siret = (siren, n) => `${siren}0001${n}`.slice(0, 14);
// commune → rows: [key, referrals received, siret or null]
const PLAN = {
  L: { ville: 'Lauterbourg', cp: '67630', rows: [['x1', 7, siret(SIREN.X, 1)], ['x2', 6, siret(SIREN.X, 2)], ['x3', 6, siret(SIREN.X, 3)], ['y1', 6, null]] },
  I: { ville: 'Ingwiller', cp: '67340', rows: [['z1', 7, siret(SIREN.Z, 1)], ['z2', 6, siret(SIREN.Z, 2)], ['z3', 6, siret(SIREN.Z, 3)], ['w1', 6, null], ['v1', 1, null]] },
  W: { ville: 'Wissembourg', cp: '67160', rows: [['a1', 7, null], ['b1', 6, null], ['c1', 6, null], ['d1', 6, null]] },
};
const id = (k) => `d8obs-${k}-${TS}`;
const DOSSIER = `d8obs-dos-${TS}`; const FROM = `d8obs-from-${TS}`;
// active members per record in Ingwiller (the professional observatoire's « agents » cell): per record [3, 2, 2, 2, 1], per organisation [7, 2, 1]
const MEMBERS = { z1: 3, z2: 2, z3: 2, w1: 2, v1: 1 };

describe.skipIf(!hasDatabase)('D8: the observatory counts organisations, not records (real DB)', () => {
  let db, stats; let seq = 0;
  const commune = (v, name) => v.byCommune.find((r) => r.commune === name);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    stats = await import('../../api/_services/territorial-stats.js');
    await db.execute(sql`DELETE FROM "ObservatoryQuarterSnapshot" WHERE quarter = '2012-T4'`).catch(() => {});
    const structure = (sid, ville, cp, s, verification = 'VERIFIED') => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, siret, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${sid}, ${sid}, ${sid}, 'association', '1 rue', ${ville}, ${cp}, ${s}, false, '{}', '{}', '{}', 'actif', ${verification}, NOW(), NOW())`);
    await structure(FROM, 'Strasbourg', '67000', null, 'PENDING');
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${DOSSIER}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`);
    for (const p of Object.values(PLAN)) {
      for (const [k, n, s] of p.rows) {
        await structure(id(k), p.ville, p.cp, s);
        for (let j = 0; j < n; j += 1) await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
          VALUES (${`d8obs-ref-${(seq += 1)}-${TS}`}, ${DOSSIER}, ${FROM}, ${id(k)}, 'COMPLETED', 'HOUSING', ${T4}, 'd8obs-grant', ${T4}, ${T4}, NOW())`);
      }
    }
    for (const [k, n] of Object.entries(MEMBERS)) for (let j = 0; j < n; j += 1) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt", "createdAt")
      VALUES (${`d8obs-u-${k}-${j}-${TS}`}, ${`d8obs-u-${k}-${j}-${TS}@example.test`}, 'x', 'PRO', 'active', ${id(k)}, NOW(), NOW())`);
    // Wissembourg: d1 is « the same organisation » as a1 (the duplicate register kept a1)
    const [a, b] = [id('a1'), id('d1')].sort();
    await db.execute(sql`INSERT INTO "StructureDuplicateDecision" (id, "structureA", "structureB", decision, "primaryId", "evidenceUrl", note, "reviewerId", "versionA", "versionB")
      VALUES (${`d8obs-dec-${TS}`}, ${a}, ${b}, 'SAME_ENTITY', ${id('a1')}, 'https://annuaire-entreprises.data.gouv.fr/', 'D8 test', 'd8-reviewer', 'v', 'v')`);
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ObservatoryQuarterSnapshot" WHERE quarter = '2012-T4'`).catch(() => {});
    await db.execute(sql`DELETE FROM "StructureDuplicateDecision" WHERE id = ${`d8obs-dec-${TS}`}`);
    await db.execute(sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id LIKE ${`d8obs-u-%-${TS}`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`d8obs-%-${TS}`}`);
  });

  it('four records of TWO organisations (three establishments of one SIREN): the commune is not shown (fewer than 3 organisations)', async () => {
    const v = await stats.observatoire(db, NOW);
    expect(v.window.period).toBe('2012-T4');
    expect(commune(v, 'Lauterbourg'), 'one legal entity cannot make « 3 organisations » alone').toBeUndefined();
  });

  it('three establishments of one SIREN are ONE contributor: that organisation could subtract its share and read the other one\'s — masked', async () => {
    const v = await stats.observatoire(db, NOW);
    const row = commune(v, 'Ingwiller');
    expect(row, 'three organisations: the commune is shown').toBeDefined();
    // per record [7, 6, 6, 6, 1] passed the p % rule; per organisation [19, 6, 1]: the largest knows its 19, a coalition of two recovers everything
    expect(row.sent).toBeNull();
  });

  it('the professionals\' observatoire: the active-member cell is grouped by organisation too (one SIREN\'s three records = one contributor)', async () => {
    const orgStats = await import('../../api/_services/org-stats.js');
    const reg = await orgStats.regionalStats({ userId: `d8obs-u-w1-0-${TS}`, structureId: id('w1') }, db, NOW);
    expect(reg.ok, JSON.stringify(reg)).toBe(true);
    const city = reg.stats.cities.find((c) => c.name === 'Ingwiller');
    expect(city).toBeDefined();
    expect(city.agents, 'per organisation [7, 2, 1]: the two others recover the 7').toBeNull();
  });

  it('a record put aside as a duplicate counts with the record kept: masked', async () => {
    const v = await stats.observatoire(db, NOW);
    const row = commune(v, 'Wissembourg');
    expect(row).toBeDefined();
    // per record [7, 6, 6, 6]; per organisation [13, 6, 6]: a coalition of the two others recovers the 13
    expect(row.sent).toBeNull();
  });

  it('the read-only model view (api/lib/structure-model.js) shows the same organisations from the same data, and writes nothing', async () => {
    const { structureModelView } = await import('../../api/lib/structure-model.js');
    const before = (await db.execute(sql`SELECT count(*)::int AS n, max("updatedAt") AS u FROM "Structure"`)).rows[0];
    const x1 = await structureModelView(db, id('x1'));
    expect(x1.organisation).toMatchObject({ basis: 'SIREN', siren: SIREN.X });
    expect(x1.organisation.otherEstablishments.map((e) => e.id).sort()).toEqual([id('x2'), id('x3')].sort());
    expect(x1.establishment.identifiers.siret).toBe(siret(SIREN.X, 1));
    expect((await structureModelView(db, id('d1'))).organisation).toMatchObject({ key: `id:${id('a1')}`, basis: 'DUPLICATE_DECISION' });
    expect((await structureModelView(db, id('y1'))).organisation).toMatchObject({ key: `id:${id('y1')}`, basis: 'RECORD' });
    expect(await structureModelView(db, `nope-${TS}`)).toBeNull();
    expect((await db.execute(sql`SELECT count(*)::int AS n, max("updatedAt") AS u FROM "Structure"`)).rows[0]).toEqual(before);
  });
});
