/**
 * R36 — the aide word search on REAL PostgreSQL (French stemming): « aidant » stems to « aid » like « aide », « 18 ans » to « an »; those stems, present in
 * every aide, used to rank an unrelated aide first (production 02/11/2026: « aidant épuisé, ma mère a besoin d'aide à domicile » → ARCE; « je sors de
 * l'ASE à 18 ans… » → ARCE). The query now keeps only the meaningful words, without the generic stems. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
const A = { arce: `r36s-arce-${N}`, apa: `r36s-apa-${N}`, als: `r36s-als-${N}` };

describe.skipIf(!hasDatabase)('aide word search without generic stems (real DB)', () => {
  let db; let searchAidesHybrid;
  const ids = async (query) => (await searchAidesHybrid({ query, limit: 10 })).items.map((x) => x.id).filter((id) => Object.values(A).includes(id));
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ searchAidesHybrid } = await import('../../api/lib/hybrid-search.js'));
    const add = (id, titre, cestQuoi) => db.execute(sql`INSERT INTO "Aide" (id, slug, titre, cest_quoi, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
      VALUES (${id}, ${id}, ${titre}, ${cestQuoi}, 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW(), 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', NOW())`);
    await add(A.arce, `Aide à la reprise ou à la création d'entreprise ${N}`, 'Une aide, puis une autre aide : cette aide aux créateurs est une aide versée en deux fois. Aide pour les demandeurs de 18 ans et plus, aide sans condition d’âge maximal. Les personnes qui en ont besoin.');
    await add(A.apa, `Allocation personnalisée d'autonomie ${N}`, 'Pour une personne âgée qui vit à domicile et a besoin d’aide pour les actes de la vie quotidienne.');
    await add(A.als, `Allocation de logement ${N}`, 'Pour payer le loyer de son logement.');
  });
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`r36s-%-${N}`}`); });

  it('the meaningful words rank the right aide; the generic stems no longer pull the unrelated one', async () => {
    expect((await ids("aidant épuisé, ma mère a besoin d'aide à domicile"))[0]).toBe(A.apa);
    const ase = await ids("je sors de l'ASE à 18 ans et je n'ai pas de logement");
    expect(ase[0]).toBe(A.als);   // the ARCE may follow on « 18 » (a real word of its text), never before the housing aide
  });
  it('a query made only of generic words matches nothing rather than everything', async () => {
    expect(await ids("besoin d'aide")).toEqual([]);
  });
  it('a precise query still finds its aide (the ARCE by its own words)', async () => {
    expect((await ids("création d'entreprise"))[0]).toBe(A.arce);
  });
});
