/**
 * R3H — live audit 24/11/2026: /api/public/indicators counted every published aide as « AUTRE » / « UNSPECIFIED » because the catalogue import writes
 * `categorie` and the territory fields, never category_code / territory_scope. On a REAL database: records shaped like the Production import (category_code
 * left at its default, territory_scope NULL) are now classified from `categorie` and their declared territory; explicit values still win.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_TEST);
const P = `r3h-${Date.now().toString(36)}`;
const SP = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F';
const pgArray = (a) => `{${a.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')}}`;   // a text[] literal (drizzle would expand a JS array into a list)

describe.skipIf(!hasDatabase)('R3H indicators classification (real DB)', () => {
  let db, compute, before, after;
  // a record as the catalogue import writes it: category_code and territory_scope not set (schema default AUTRE, NULL)
  const imported = (id, { categorie, territoires = [], departements = [], url = `${SP}${id}`, code = null, scope = null }) => sql`INSERT INTO "Aide"
    (id, slug, titre, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, categorie, territoires, departements,
     ${code ? sql`category_code,` : sql``} territory_scope, "updatedAt")
    VALUES (${id}, ${id}, ${'Aide ' + id}, 'publie', true, 'VERIFIED', 'reviewer-r3h@example.test', true, NOW() - interval '3 days', 'official', ${url}, ${categorie},
      ${pgArray(territoires)}::text[], ${pgArray(departements)}::text[], ${code ? sql`${code}::"AidCategoryCode",` : sql``} ${scope}, NOW())`;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ computePublicIndicators: compute } = await import('../../api/_services/public-indicators.js'));
    before = await compute({ db });
    const id = (s) => `${P}-${s}`;
    await db.execute(imported(id('fam'), { categorie: 'famille' }));                                                   // SP fiche, no territory
    await db.execute(imported(id('tf'), { categorie: 'travail-formation' }));
    await db.execute(imported(id('sante'), { categorie: 'santé', territoires: ['France entière'] }));
    await db.execute(imported(id('ss'), { categorie: 'social-sante' }));                                               // ambiguous: AUTRE
    await db.execute(imported(id('apl67'), { categorie: 'logement', territoires: ['Strasbourg'], departements: ['67'] }));
    await db.execute(imported(id('town'), { categorie: 'logement', territoires: ['Strasbourg'] }));                    // a town name alone
    await db.execute(imported(id('faj'), { categorie: 'budget', url: 'https://www.strasbourg.eu/fond-aide-jeunes' })); // not Service-Public, no territory
    await db.execute(imported(id('expl'), { categorie: 'logement', code: 'HANDICAP', scope: 'REGIONAL' }));           // explicit values win
    after = await compute({ db });
  }, 120000);

  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`${P}-%`}`); });

  const d = (key, field, v) => (after[key].find((x) => x[field] === v).count - before[key].find((x) => x[field] === v).count);
  it('domains from categorie (fixed table), explicit category_code first', () => {
    expect(after.catalogue.aides - before.catalogue.aides).toBe(8);
    expect(d('aidesByDomain', 'domain', 'FAMILLE')).toBe(1);
    expect(d('aidesByDomain', 'domain', 'EMPLOI')).toBe(1);
    expect(d('aidesByDomain', 'domain', 'SANTE')).toBe(1);
    expect(d('aidesByDomain', 'domain', 'LOGEMENT')).toBe(2);
    expect(d('aidesByDomain', 'domain', 'HANDICAP')).toBe(1);
    expect(d('aidesByDomain', 'domain', 'AUTRE')).toBe(2);   // social-sante, budget
  });
  it('échelons from the declared territory, Service-Public without territory = national', () => {
    expect(d('aidesByScope', 'scope', 'NATIONAL')).toBe(4);       // fam, tf, ss (SP, no territory) + sante (France entière)
    expect(d('aidesByScope', 'scope', 'DEPARTMENTAL')).toBe(1);   // apl67
    expect(d('aidesByScope', 'scope', 'REGIONAL')).toBe(1);       // explicit
    expect(d('aidesByScope', 'scope', 'UNSPECIFIED')).toBe(2);    // town, faj
  });
});
