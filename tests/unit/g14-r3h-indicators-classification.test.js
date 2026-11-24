/**
 * R3H — live audit of 24/11/2026: /api/public/indicators counted the 124 published aides as « AUTRE » (every domain 0) and « UNSPECIFIED » (every échelon 0).
 * Root cause: the catalogue import never writes "Aide".category_code (schema default AUTRE) nor "Aide".territory_scope (null); it writes `categorie` and
 * the declared territory fields. The indicator now reads those, through a fixed table (domain) and the record's own declarations (échelon).
 * The LIVE distribution below is the one of the public /api/aides list on 24/11/2026 (categorie, territoires, host of source_url).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: { execute: async () => { throw new Error('no database in this unit test'); } } }));
const { aideDomain, aideScope, domainCounts, scopeCounts, DOMAIN_OF_CATEGORIE, computePublicIndicators } = await import('../../api/_services/public-indicators.js');
const { AidCategoryCode } = await import('../../src/db/schema.js');

const SP = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1';
/** [count, categorie, territoires, host] — /api/aides, Production, 24/11/2026 */
const LIVE = [
  [42, 'famille', [], 'www'], [17, 'logement', [], 'www'], [12, 'social-sante', [], 'www'], [11, 'argent', [], 'www'], [9, 'travail-formation', [], 'www'],
  [7, 'personnes-agees', [], 'www'], [6, 'social', ['France entière'], 'www'], [4, 'transports', [], 'www'], [3, 'loisirs', [], 'www'], [2, 'justice', [], 'www'],
  [2, 'handicap', [], 'www'], [1, 'social-sante', [], 'entreprendre'], [1, 'credit', ['France entière'], 'www'], [1, 'loisirs', ['France entière'], 'www'],
  [1, 'logement', ['Strasbourg'], 'www'], [1, 'mobilite', ['France entière'], 'www'], [1, 'justice', ['France entière'], 'www'], [1, 'santé', ['France entière'], 'www'],
  [1, 'logement', ['France entière'], 'www'], [1, 'papiers-citoyennete', [], 'www'],
];
const liveRows = () => LIVE.flatMap(([n, categorie, territoires, host]) => Array.from({ length: n }, () => ({
  category_code: 'AUTRE', categorie, territory_scope: null, territoires, departements: [], department_codes: [], region_codes: [], insee_codes: [],
  source_url: `https://${host}.service-public.gouv.fr/particuliers/vosdroits/F1`,
})));
const count = (list, key, v) => list.find((x) => x[key] === v).count;

describe('R3H domain of an aide', () => {
  it('an explicit category_code other than AUTRE wins; else the catalogue category through the fixed table; unknown → AUTRE', () => {
    expect(aideDomain({ category_code: 'SANTE', categorie: 'logement' })).toBe('SANTE');
    expect(aideDomain({ category_code: 'AUTRE', categorie: 'logement' })).toBe('LOGEMENT');
    expect(aideDomain({ category_code: 'AUTRE', categorie: 'Santé' })).toBe('SANTE');           // accent and case folded
    expect(aideDomain({ category_code: 'AUTRE', categorie: 'travail-formation' })).toBe('EMPLOI');
    expect(aideDomain({ category_code: 'AUTRE', categorie: 'transports' })).toBe('MOBILITE');
    expect(aideDomain({ category_code: 'AUTRE', categorie: 'social-sante' })).toBe('AUTRE');    // ambiguous (RSA, prime d'activité, ARE…): never guessed
    expect(aideDomain({ category_code: null, categorie: null })).toBe('AUTRE');
  });
  it('the table only targets codes of the AidCategoryCode enumeration', () => {
    for (const code of Object.values(DOMAIN_OF_CATEGORIE)) expect(AidCategoryCode.enumValues).toContain(code);
  });
});

describe('R3H échelon of an aide', () => {
  it('explicit territory_scope first; an unreadable value stays UNSPECIFIED', () => {
    expect(aideScope({ territory_scope: 'communal', source_url: SP })).toBe('COMMUNAL');
    expect(aideScope({ territory_scope: 'something-else', source_url: SP })).toBe('UNSPECIFIED');
  });
  it('then the declared territory fields, then a Service-Public fiche without territory is national', () => {
    expect(aideScope({ insee_codes: ['67482'] })).toBe('COMMUNAL');
    expect(aideScope({ territoires: ['France entière'], departements: ['67'] })).toBe('NATIONAL');
    expect(aideScope({ territoires: ['Eurométropole de Strasbourg'], departements: ['67'] })).toBe('DEPARTMENTAL');
    expect(aideScope({ territoires: ['Grand Est'], region_codes: ['44'] })).toBe('REGIONAL');
    expect(aideScope({ territoires: [], source_url: SP })).toBe('NATIONAL');
    expect(aideScope({ territoires: [], source_url: 'https://entreprendre.service-public.gouv.fr/vosdroits/F15252' })).toBe('NATIONAL');
    expect(aideScope({ territoires: ['Strasbourg'], source_url: SP })).toBe('UNSPECIFIED');    // a town name alone is not an échelon
    expect(aideScope({ territoires: [], source_url: 'https://www.strasbourg.eu/fond-aide-jeunes' })).toBe('UNSPECIFIED');
    expect(aideScope({ territoires: [], source_url: 'https://service-public.gouv.fr.evil.example/x' })).toBe('UNSPECIFIED');
  });
});

describe('R3H the live catalogue of 24/11/2026 is no longer « all AUTRE / all UNSPECIFIED »', () => {
  it('domains', () => {
    const d = domainCounts(liveRows());
    expect(d.map((x) => x.domain)).toEqual(AidCategoryCode.enumValues);
    expect(d.reduce((n, x) => n + x.count, 0)).toBe(124);
    expect(count(d, 'domain', 'FAMILLE')).toBe(42);
    expect(count(d, 'domain', 'LOGEMENT')).toBe(19);
    expect(count(d, 'domain', 'EMPLOI')).toBe(9);
    expect(count(d, 'domain', 'MOBILITE')).toBe(5);
    expect(count(d, 'domain', 'JUSTICE')).toBe(3);
    expect(count(d, 'domain', 'HANDICAP')).toBe(2);
    expect(count(d, 'domain', 'SANTE')).toBe(1);
    expect(count(d, 'domain', 'AUTRE')).toBe(43);
  });
  it('échelons', () => {
    const s = scopeCounts(liveRows());
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(124);
    expect(count(s, 'scope', 'NATIONAL')).toBe(123);
    expect(count(s, 'scope', 'UNSPECIFIED')).toBe(1);
  });
  it('the computation reads category_code, categorie and the territory fields of the VISIBLE aides only, and returns counts only', async () => {
    const seen = [];
    const db = { execute: async (q) => { const text = JSON.stringify(q.queryChunks ?? q); seen.push(text); return { rows: /categorie, territory_scope/.test(text) ? liveRows() : [] }; } };
    const out = await computePublicIndicators({ db, now: new Date('2026-11-24T04:00:00Z') });
    expect(count(out.aidesByDomain, 'domain', 'FAMILLE')).toBe(42);
    expect(count(out.aidesByScope, 'scope', 'NATIONAL')).toBe(123);
    expect(JSON.stringify(out.aidesByDomain)).not.toMatch(/service-public|famille"/);
  });
});
