/**
 * R40 — « aide active à mourir loi » on REAL PostgreSQL (French stemming): « loi » and « loyer » share the stem « loi », « active » matches « solidarité
 * active »; Production 03/11/2026 listed the APL, the RSA and the ALS. The query now searches the official expression « fin de vie » as ONE phrase
 * (phraseto_tsquery), the legal word « loi » is not a search word, and a short term of the word plans matches whole words (\m…\M). Synthetic data only;
 * skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
const A = { rent: `r40s-rent-${N}`, rsa: `r40s-rsa-${N}`, are: `r40s-are-${N}`, eol: `r40s-eol-${N}` };

describe.skipIf(!hasDatabase)('end-of-life and legal words in the aide search (real DB)', () => {
  let db; let searchAidesHybrid; let wordPlan;
  const ids = async (query) => (await searchAidesHybrid({ query, limit: 10 })).items.map((x) => x.id).filter((id) => Object.values(A).includes(id));
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ searchAidesHybrid } = await import('../../api/lib/hybrid-search.js'));
    ({ wordPlan } = await import('../../api/lib/search-query.js'));
    const add = (id, titre, cestQuoi) => db.execute(sql`INSERT INTO "Aide" (id, slug, titre, cest_quoi, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
      VALUES (${id}, ${id}, ${titre}, ${cestQuoi}, 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW(), 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', NOW())`);
    await add(A.rent, `Aide au logement ${N}`, 'Pour payer le loyer de son logement. Le loyer et les loyers sont pris en compte.');
    await add(A.rsa, `Revenu de solidarité active ${N}`, 'Un revenu minimum pour les personnes sans ressources, la solidarité active.');
    await add(A.are, `Allocation chômage ${N}`, 'Versée à la fin de contrat de travail, pour la vie professionnelle.');
    await add(A.eol, `Allocation journalière d'accompagnement d'une personne en fin de vie ${N}`, 'Pour accompagner un proche en fin de vie.');
  });
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`r40s-%-${N}`}`); });

  it('« aide active à mourir loi » finds the end-of-life aide only — not the rent aide (« loi » = « loyer »), the RSA or the ARE', async () => {
    expect(await ids('aide active à mourir loi')).toEqual([A.eol]);
    expect(await ids('suicide assisté loi')).toEqual([A.eol]);
  });
  it('« loi » alone searches nothing; « loyer » still finds the rent aide', async () => {
    expect(await ids('loi')).toEqual([]);
    expect((await ids('aide pour payer mon loyer'))[0]).toBe(A.rent);
  });
  it('the words of « fin de contrat » still find the ARE', async () => {
    expect((await ids('fin de contrat'))[0]).toBe(A.are);
  });
  it('a short term of the word plans matches whole words in PostgreSQL (« vie » is not in « envie » or « service »)', async () => {
    const match = async (q) => {
      const plan = wordPlan(q, ['"titre"', '"cest_quoi"'], '"titre"', false);
      const res = await db.execute(sql`SELECT id FROM "Aide" WHERE id LIKE ${`r40s-%-${N}`} AND ${plan.matchCount} > 0 ORDER BY id`);
      return (res.rows || res).map((r) => r.id);
    };
    expect(await match('vie')).toEqual([A.are, A.eol].sort());
    expect(await match('fin de vie')).toEqual([A.eol]);
    expect(await match('envie')).toEqual([]);
  });
});
