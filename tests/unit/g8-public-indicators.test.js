/**
 * G8 — public indicators of the Observatoire (owner decision C8/D4 « new metrics », closed flag). No database: the computation is injected.
 *   F  closed by default: ADA_PUBLIC_INDICATORS must be exactly « open »; the beta gate and the handler both follow it (404 while closed, compute never called)
 *   P  no row-level or personal field can leave: assertAggregateOnly() refuses ids, slugs, names of fields that hold a person or a reviewer, e-mails, links,
 *      phone numbers, free text and long lists — and the handler answers 500 instead of sending such a body
 *   S  structures by commune: the observatory's suppression (cells below 5 masked, complementary masking when exactly one cell is masked)
 *   W  the registry: every indicator says what it is, where it comes from, why it is not personal data and what it does NOT mean; no text asserts a right
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: async () => { throw new Error('no database in this unit test'); } } }));

const { assertAggregateOnly, publicIndicatorsOpen, PUBLIC_INDICATORS, FORBIDDEN_KEYS, SCHEMA } = await import('../../api/lib/public-indicators.js');
const { isAllowedInPublicBeta } = await import('../../api/_utils/public-beta.js');
const { default: handler, _resetIndicatorsCache } = await import('../../api/_handlers/public/indicators.js');
const { communeTable, rightsNeeds } = await import('../../api/_services/public-indicators.js');
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');

const res = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });
/** a realistic body, as the service builds it */
export const SAMPLE = Object.freeze({
  schema: SCHEMA, computedAt: '2026-11-19T10:00:00.000Z',
  rules: { visibility: 'D5_STRICT', currentDays: 90, maxAgeDays: 180, kMin: 5, linkWindowDays: 35 },
  catalogue: { aides: 120, demarches: 80, structures: 300, dispositifs: 4, guides: 37, actualites: 10 },
  aidesByDomain: [{ domain: 'LOGEMENT', count: 20 }, { domain: 'AUTRE', count: 0 }],
  aidesByScope: [{ scope: 'NATIONAL', count: 100 }, { scope: 'UNSPECIFIED', count: 20 }],
  structuresByCommune: { cells: [{ commune: '67482', label: 'Strasbourg', count: 200 }, { commune: '67218', label: 'Illkirch-Graffenstaden', count: 12 }], maskedCommunes: 3, notLocated: 40, kMin: 5 },
  freshness: { aide: { visible: 120, current: 100, updateNeeded: 20, currentShare: 83.3 } },
  linkHealth: { measured: true, windowDays: 35, lastCheckedOn: '2026-11-16', addresses: 50, reachable: 40, redirected: 5, broken: 2, inconclusive: 3 },
  translations: { languages: { en: { aide: { full: 10, partial: 2 } } }, of: { aide: 120 } },
  structuresInformation: { visible: 300, stepFreeAccessIndicated: 80, openingHoursIndicated: 150 },
  rightsNeeds: { needs: 22, officialFiches: 60, sourcesReadOn: '2026-11-18' },
});
const BETA = { ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };

beforeEach(() => { _resetIndicatorsCache(); delete process.env.ADA_PUBLIC_INDICATORS; });
afterEach(() => { delete process.env.ADA_PUBLIC_INDICATORS; });

describe('G8 F — closed by default', () => {
  it('only the exact value « open » opens it', () => {
    for (const v of [undefined, '', '1', 'true', 'yes', 'opened', 'on']) expect(publicIndicatorsOpen({ ADA_PUBLIC_INDICATORS: v }), String(v)).toBe(false);
    expect(publicIndicatorsOpen({ ADA_PUBLIC_INDICATORS: 'open' })).toBe(true);
    expect(publicIndicatorsOpen({ ADA_PUBLIC_INDICATORS: ' OPEN ' })).toBe(true);
  });
  it('the beta gate refuses the route while closed (Production configuration today) and serves GET / HEAD only once open', () => {
    expect(isAllowedInPublicBeta('GET', 'public/indicators', BETA)).toBe(false);
    const open = { ...BETA, ADA_PUBLIC_INDICATORS: 'open' };
    expect(isAllowedInPublicBeta('GET', 'public/indicators', open)).toBe(true);
    expect(isAllowedInPublicBeta('HEAD', 'public/indicators', open)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'public/indicators', open)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'public/indicators/x', open)).toBe(false);
    // it opens nothing else of « public/ »
    expect(isAllowedInPublicBeta('GET', 'public/passport', open)).toBe(false);
  });
  it('the handler answers 404 while closed and never computes', async () => {
    const compute = vi.fn(async () => SAMPLE);
    const r = res(); await handler({ method: 'GET', headers: {} }, r, { compute });
    expect(r.statusCode).toBe(404); expect(compute).not.toHaveBeenCalled();
  });
  it('open: 200, dated, cached, public cache header; other methods 405', async () => {
    process.env.ADA_PUBLIC_INDICATORS = 'open';
    const compute = vi.fn(async () => SAMPLE);
    let r = res(); await handler({ method: 'GET', headers: {} }, r, { compute });
    expect(r.statusCode).toBe(200); expect(r.body.computedAt).toBe(SAMPLE.computedAt); expect(r.headers['Cache-Control']).toMatch(/^public/);
    r = res(); await handler({ method: 'GET', headers: {} }, r, { compute });
    expect(compute).toHaveBeenCalledTimes(1);
    r = res(); await handler({ method: 'POST', headers: {} }, r, { compute });
    expect(r.statusCode).toBe(405);
  });
});

describe('G8 P — no row-level or personal field can appear', () => {
  it('the realistic body passes', () => { expect(assertAggregateOnly(SAMPLE)).toBe(true); });
  it.each([
    ['a record id', { cells: [{ id: 'abc', count: 9 }] }],
    ['a slug', { x: { slug: 'aide-logement' } }],
    ['a reviewer', { verified_by: 'x' }],
    ['a person reference', { rows: [{ citizenUserId: 'u1' }] }],
    ['an e-mail in a value', { label: 'jean.dupont@example.fr' }],
    ['a link in a value', { label: 'https://www.service-public.fr/x' }],
    ['a phone number in a value', { label: '03 88 12 34 56' }],
    ['free text', { label: 'Madame Martin a demandé une aide au logement le 3 novembre.' }],
    ['a function', { f: () => 1 }],
    ['a non-finite number', { n: Number.NaN }],
    ['a long list', { list: Array.from({ length: 401 }, () => 1) }],
  ])('refuses %s', (_, body) => { expect(() => assertAggregateOnly(body)).toThrow(/public indicators/); });
  it('every forbidden key is refused at any depth', () => {
    for (const k of FORBIDDEN_KEYS) expect(() => assertAggregateOnly({ a: [{ b: { [k]: 1 } }] }), k).toThrow();
  });
  it('the handler sends 500, never the body, when the computation returns a row-level field', async () => {
    process.env.ADA_PUBLIC_INDICATORS = 'open';
    const leaky = { ...SAMPLE, structuresByCommune: { ...SAMPLE.structuresByCommune, cells: [{ commune: '67482', label: 'Strasbourg', count: 200, nom: 'CCAS de Strasbourg' }] } };
    const r = res(); await handler({ method: 'GET', headers: {} }, r, { compute: async () => leaky });
    expect(r.statusCode).toBe(500); expect(JSON.stringify(r.body)).not.toMatch(/CCAS/); expect(r.body).toEqual({ error: 'INDICATORS_UNAVAILABLE' });
  });
});

describe('G8 S — structures by commune use the observatory suppression', () => {
  const rows = (ville, code_postal, n) => Array.from({ length: n }, () => ({ ville, code_postal }));
  it('a commune below 5 is masked, and the complementary cell too; totals are never re-derivable from one masked cell', () => {
    const t = communeTable([...rows('Strasbourg', '67000', 9), ...rows('Schiltigheim', '67300', 5), ...rows('Illkirch-Graffenstaden', '67400', 2), ...rows('Nulle-Part-Sur-Mer', '99999', 6)]);
    expect(t.kMin).toBe(5);
    // Illkirch (2) masked by the threshold; exactly one masked cell → the smallest published one (Schiltigheim, 5) is masked too
    expect(t.cells).toEqual([{ commune: '67482', label: 'Strasbourg', count: 9 }]);
    expect(t.maskedCommunes).toBe(2);
    expect(t.notLocated).toBe(6);
    expect(assertAggregateOnly(t)).toBe(true);
  });
  it('a small « not located » cell is masked too', () => {
    const t = communeTable([...rows('Strasbourg', '67000', 9), ...rows('Schiltigheim', '67300', 7), ...rows('Atlantis', '00000', 2)]);
    expect(t.notLocated).toBeNull();
    expect(t.cells.map((c) => c.count)).toEqual([9]);   // complementary: Schiltigheim (smallest published) masked
  });
  it('nothing masked when every cell reaches the threshold', () => {
    const t = communeTable([...rows('Strasbourg', '67000', 6), ...rows('Schiltigheim', '67300', 5)]);
    expect(t.cells.map((c) => c.count)).toEqual([6, 5]); expect(t.maskedCommunes).toBe(0); expect(t.notLocated).toBe(0);
  });
});

describe('G8 W — registry and the /droits figures', () => {
  it('every indicator is fully described, and no text asserts a right or claims to measure non-take-up or people helped', () => {
    expect(PUBLIC_INDICATORS.length).toBeGreaterThanOrEqual(8);
    for (const m of PUBLIC_INDICATORS) {
      for (const f of ['id', 'label', 'definition', 'source', 'refresh', 'notPersonal', 'isNot']) expect(String(m[f] || '').trim().length, `${m.id}.${f}`).toBeGreaterThan(3);
      for (const f of ['label', 'definition', 'notPersonal', 'isNot']) expect(claimsEntitlement(m[f]), `${m.id}.${f}`).toBe(false);
      expect(`${m.label} ${m.definition}`).not.toMatch(/non-recours|personnes aidées|visites|recherches effectuées/i);
    }
    expect(new Set(PUBLIC_INDICATORS.map((m) => m.id)).size).toBe(PUBLIC_INDICATORS.length);
  });
  it('the /droits figures come from the generated public view', () => {
    const r = rightsNeeds();
    expect(r).not.toBeNull(); expect(r.needs).toBeGreaterThan(0); expect(r.officialFiches).toBeGreaterThan(0); expect(r.sourcesReadOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
