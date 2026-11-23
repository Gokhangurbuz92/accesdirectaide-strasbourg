/**
 * G14-FIND — on REAL PostgreSQL: (1) a four-letter term (CCAS, CPAM, MDPH) must START a word — « CCAS » listed « Certificat d’immatriculation : véhicule
 * d'occasion » (« oCCASion ») — while three letters stay whole words (« CAF » ≠ « café ») and longer terms keep the substring match; (2) the global
 * search (/api/search, the /recherche page) chooses places the way the directory does when a commune is given: the places recorded for that commune, else
 * the covered territory (Eurométropole), else anywhere — and says which (structuresScope). A commune named after an office type (« CCAS Schiltigheim »)
 * counts as the commune. Synthetic rows only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-7);
const A = { occasion: `g14w-occ-${N}`, ccas: `g14w-ccas-${N}`, cpam: `g14w-cpam-${N}`, cafe: `g14w-cafe-${N}`, caf: `g14w-caf-${N}`, soins: `g14w-soins-${N}`, mdph: `g14w-mdph-${N}` };
const S = { bischheim: `g14w-st-bis-${N}`, strasbourg: `g14w-st-sxb-${N}`, haguenau: `g14w-st-hag-${N}`, cafSchilt: `g14w-st-caf-${N}` };
const CCAS_TYPE = "CCAS (centre communal d'action sociale)";
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {}, end() { return this; } });

describe.skipIf(!hasDatabase)('G14-FIND: word-aware matching and the commune in the global search (real DB)', () => {
  let db; let wordPlan; let handler;
  const match = async (q) => {
    const plan = wordPlan(q, ['"titre"', '"cest_quoi"'], '"titre"', false);
    const res = await db.execute(sql`SELECT id FROM "Aide" WHERE id LIKE ${`g14w-%-${N}`} AND ${plan.matchCount} > 0 ORDER BY id`);
    return (res.rows || res).map((r) => r.id);
  };
  const search = async (query, territory) => {
    const r = mk();
    await handler({ method: 'POST', url: '/api/search', headers: {}, query: {}, body: { query, limit: 10, ...(territory ? { territory } : {}) } }, r);
    expect(r.statusCode, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    return r.body;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ wordPlan } = await import('../../api/lib/search-query.js'));
    ({ default: handler } = await import('../../api/_handlers/search.js'));
    const aide = (id, titre, cestQuoi) => db.execute(sql`INSERT INTO "Aide" (id, slug, titre, cest_quoi, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
      VALUES (${id}, ${id}, ${titre}, ${cestQuoi}, 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW(), 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', NOW())`);
    await aide(A.occasion, `Immatriculer un véhicule d'occasion ${N}`, 'Certificat d’immatriculation pour une voiture d’occasion.');
    await aide(A.ccas, `Aide facultative du CCAS ${N}`, 'Demande au centre communal d’action sociale.');
    await aide(A.cpam, `Remboursement par la CPAM ${N}`, 'La caisse primaire rembourse les soins.');
    await aide(A.cafe, `Café solidaire ${N}`, 'Un café pour se rencontrer.');
    await aide(A.caf, `Allocation versée par la CAF ${N}`, 'La Caf verse l’allocation.');
    await aide(A.mdph, `Dossier MDPH ${N}`, 'Demande à la maison départementale des personnes handicapées.');
    await aide(A.soins, `Aide aux soins infirmiers ${N}`, 'Pour des soins à domicile.');
    const place = (id, nom, type, ville, insee) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees,
      statut, launch_eligible, verification_status, verified_by, territory_verified, data_origin, date_verification, source_url, insee_codes, "updatedAt", "createdAt")
      VALUES (${id}, ${nom}, ${'slug-' + id}, ${type}, '1 rue', ${ville}, '67000', false, ARRAY['accueil'], ARRAY['tout_public'], ARRAY['social'],
      'actif', true, 'VERIFIED', 'reviewer@example.test', true, 'official', NOW(), 'https://example.test/s', ${`{${insee}}`}::text[], NOW(), NOW())`);
    await place(S.bischheim, `Centre communal d'action sociale (CCAS) - Bischheim ${N}`, CCAS_TYPE, 'Bischheim', '67043');
    await place(S.strasbourg, `Centre communal d'action sociale (CCAS) - Strasbourg ${N}`, CCAS_TYPE, 'Strasbourg', '67482');
    await place(S.haguenau, `Centre communal d'action sociale (CCAS) - Haguenau ${N}`, CCAS_TYPE, 'Haguenau', '67180');
    await place(S.cafSchilt, `Caisse d'allocations familiales (Caf) - accueil de Schiltigheim ${N}`, 'Caf (Caisse d\'allocations familiales)', 'Schiltigheim', '67447');
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${`g14w-%-${N}`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`g14w-st-%-${N}`}`);
  });

  it('« CCAS » no longer matches « occasion »; CPAM and MDPH are found as words; « CAF » is not « café »', async () => {
    expect(await match('CCAS')).toEqual([A.ccas]);
    expect(await match('ccas')).toEqual([A.ccas]);
    expect(await match('CPAM')).toEqual([A.cpam]);
    expect(await match('MDPH')).toEqual([A.mdph]);
    expect(await match('CAF')).toEqual([A.caf]);
    expect(await match('occasion')).toEqual([A.occasion]);
  });
  it('a four-letter word still finds its plural and compounds (word start), a longer word its inflections (substring)', async () => {
    expect(await match('soin')).toEqual([A.cpam, A.soins].sort());
    expect(await match('immatriculation')).toEqual([A.occasion]);
  });
  it('« CCAS » + Schiltigheim (none recorded there): CCAS of the Eurométropole, said so — never a « véhicule d’occasion » sheet, never Haguenau', async () => {
    const b = await search('CCAS', '67447');
    expect(b.structuresScope).toBe('territory'); expect(b.structuresCommune).toBe('Schiltigheim');
    const ids = b.structures.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([S.bischheim, S.strasbourg])); expect(ids).not.toContain(S.haguenau);
    expect(JSON.stringify(b)).not.toMatch(/occasion/i);
  });
  it('the commune typed after the office type counts as the commune (« CCAS Schiltigheim »)', async () => {
    const b = await search('CCAS Schiltigheim');
    expect(b.structuresScope).toBe('territory'); expect(b.structuresCommune).toBe('Schiltigheim');
    expect(b.structures.map((s) => s.id)).not.toContain(S.haguenau);
  });
  it('a commune with a matching place: only its places, scope « commune »', async () => {
    const b = await search('CCAS', '67043');
    expect(b.structuresScope).toBe('commune'); expect(b.structures.map((s) => s.id)).toEqual([S.bischheim]);
    const caf = await search('CAF', '67447');
    expect(caf.structuresScope).toBe('commune'); expect(caf.structures.map((s) => s.id)).toContain(S.cafSchilt);
  });
  it('a commune outside the Eurométropole with nothing recorded: places from anywhere, scope « all »', async () => {
    const b = await search('CCAS', '67001');   // Achenheim: in the territory but nothing seeded there → territory
    expect(b.structuresScope).toBe('territory');
    const far = await search('CCAS', '67462');   // Sélestat: outside the territory, nothing recorded → all
    expect(far.structuresScope).toBe('all'); expect(far.structures.map((s) => s.id)).toContain(S.haguenau);
  });
  it('without a commune nothing changes: no scope in the answer', async () => {
    const b = await search('CCAS');
    expect(b).not.toHaveProperty('structuresScope');
  });
});
