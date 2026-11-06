/**
 * R47 quality (load acceptance) on REAL PostgreSQL — the duplicate scan of the directory (api/_services/duplicate-register.js candidates) now finds its pairs
 * with five equality joins instead of one self-join on an OR of the criteria (which compared every structure with every other). This proves the rewrite
 * finds exactly the pairs of the former query, for every criterion (SIRET, RNA and FINESS written differently, same address and postcode, similar names in
 * the same postcode), never a similar name in another postcode, and returns ties in a stable order. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const id = (/** @type {number} */ n) => `r47d-${TS}-${n}`;

/** the former query (R46), kept here as the reference the rewrite must equal */
const FORMER = sql`
  WITH s AS (SELECT id, nom, code_postal AS cp, regexp_replace(lower(coalesce(adresse, '')), '[^a-z0-9]+', '', 'g') AS addr,
      nullif(regexp_replace(coalesce(siret, ''), '[^0-9]', '', 'g'), '') AS siret, nullif(upper(regexp_replace(coalesce(rna_id, ''), '[^0-9A-Za-z]', '', 'g')), '') AS rna,
      nullif(regexp_replace(coalesce(numero_finess, ''), '[^0-9A-Za-z]', '', 'g'), '') AS finess FROM "Structure")
  SELECT a.id AS a, b.id AS b FROM s a JOIN s b ON a.id < b.id AND ((a.siret IS NOT NULL AND a.siret = b.siret) OR (a.rna IS NOT NULL AND a.rna = b.rna) OR (a.finess IS NOT NULL AND a.finess = b.finess)
    OR (a.addr <> '' AND a.addr = b.addr AND a.cp IS NOT DISTINCT FROM b.cp) OR (a.cp = b.cp AND similarity(coalesce(a.nom, ''), coalesce(b.nom, '')) >= 0.6))
  WHERE a.id LIKE ${`r47d-${TS}-%`} AND b.id LIKE ${`r47d-${TS}-%`}`;

describe.skipIf(!hasDatabase)('R47 duplicate scan: same pairs as the former query (real DB)', () => {
  let db, reg;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    reg = await import('../../api/_services/duplicate-register.js');
    const ins = (n, nom, adresse, cp, extra = {}) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut,
        siret, rna_id, numero_finess, "updatedAt", "createdAt")
      VALUES (${id(n)}, ${nom}, ${id(n)}, 'association', ${adresse}, 'Strasbourg', ${cp}, false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif',
        ${extra.siret ?? null}, ${extra.rna ?? null}, ${extra.finess ?? null}, NOW(), NOW())`);
    const k = String(Date.now()).slice(-7);
    await ins(1, `Kappa ${TS} un`, `10 rue K1 ${TS}`, '67901', { rna: `W67${k}01` }); await ins(2, `Lambda ${TS} deux`, `11 rue K2 ${TS}`, '67902', { rna: `w67-${k}-01` });   // same RNA, written differently
    await ins(3, `Mu ${TS} trois`, `12 rue K3 ${TS}`, '67903', { finess: `67${k}3` }); await ins(4, `Nu ${TS} quatre`, `13 rue K4 ${TS}`, '67904', { finess: `67 ${k} 3` });   // same FINESS
    await ins(5, `Xi ${TS}`, `14, Rue K5 ${TS}`, '67905'); await ins(6, `Omicron ${TS}`, `14 rue k5 ${TS}`, '67905');   // same address and postcode
    await ins(7, `Maison des solidarités Neudorf ${TS}`, `15 rue ${TS}`, '67906'); await ins(8, `Maison des solidarités du Neudorf ${TS}`, `16 rue ${TS}`, '67906');   // similar names, same postcode
    await ins(9, `Maison des solidarités Neudorf ${TS}`, `17 rue ${TS}`, '67907');   // the same name in another postcode: never a pair with 7 / 8
    await ins(10, `Pi ${TS} isolée`, `18 rue ${TS}`, '67908');
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`r47d-${TS}-%`}`).catch(() => {}); });

  it('finds exactly the former pairs, each criterion included, nothing across postcodes', async () => {
    const former = (await db.execute(FORMER)).rows.map((r) => `${r.a}|${r.b}`).sort();
    const now = (await reg.candidates({ db, limit: 200 })).candidates.filter((c) => c.a.startsWith(`r47d-${TS}-`) && c.b.startsWith(`r47d-${TS}-`));
    const pairs = now.map((c) => `${c.a}|${c.b}`).sort();
    expect(pairs.filter((p) => !former.includes(p))).toEqual([]);   // no pair the former query did not find
    expect(pairs).toEqual(expect.arrayContaining([`${id(1)}|${id(2)}`, `${id(3)}|${id(4)}`, `${id(5)}|${id(6)}`, `${id(7)}|${id(8)}`]));
    for (const p of [`${id(7)}|${id(9)}`, `${id(8)}|${id(9)}`]) expect(pairs).not.toContain(p);
    const byId = Object.fromEntries(now.map((c) => [`${c.a}|${c.b}`, c]));
    expect(byId[`${id(1)}|${id(2)}`].sameRna).toBe(true); expect(byId[`${id(3)}|${id(4)}`].sameFiness).toBe(true); expect(byId[`${id(5)}|${id(6)}`].sameAddress).toBe(true);
    expect(former.filter((p) => !pairs.includes(p))).toEqual([]);   // no pair of the former query is lost on this data
  });

  it('returns the same list twice (ties in a stable order)', async () => {
    const a = (await reg.candidates({ db, limit: 200 })).candidates.map((c) => `${c.a}|${c.b}`);
    const b = (await reg.candidates({ db, limit: 200 })).candidates.map((c) => `${c.a}|${c.b}`);
    expect(a).toEqual(b);
  });
});
