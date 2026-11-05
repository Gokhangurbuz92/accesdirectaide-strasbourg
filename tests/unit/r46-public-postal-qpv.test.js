// @vitest-environment node
/**
 * R46 / P07 — postal code → commune(s) and QPV from the committed official references (La Poste, ANCT), the public endpoint and its beta allowlist.
 */
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: () => '203.0.113.9',
  getRateLimitStatus: () => 429,
}));

const { resolvePostalCode, qpvForCommune, postalReferenceFreshness, resetPostalReferenceCache } = await import('../../api/lib/geography/postalReference.js');
const { default: handler } = await import('../../api/_handlers/territory.js');
const { isAllowedInPublicBeta } = await import('../../api/_utils/public-beta.js');
const rateLimit = await import('../../api/_utils/rateLimit.js');

const json = (/** @type {string} */ p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function call(/** @type {string} */ url, method = 'GET') {
  const u = new URL(url, 'http://local');
  /** @type {any} */ const res = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
  return handler(/** @type {any} */ ({ method, url, query: Object.fromEntries(u.searchParams), headers: {} }), res).then(() => res);
}

beforeEach(() => resetPostalReferenceCache());

describe('R46 P07 committed references: provenance, licence, freshness, consistency', () => {
  const postal = json('data/reference/postal-codes.v1.json');
  const qpv = json('data/reference/qpv-2024.v1.json');
  const insee = json('data/geography/insee-2026.v1.json');
  const current = new Set([...insee.communes.map((/** @type {string[]} */ c) => c[0]), ...insee.arrondissementsMunicipaux.map((/** @type {string[]} */ a) => a[0])]);

  it('names the official producer, page, file, open licence, sha256 and dates', () => {
    for (const ref of [postal, qpv]) {
      expect(ref.status).toBe('OFFICIAL_SOURCE_AS_PUBLISHED');
      expect(ref.source.page).toMatch(/^https:\/\/www\.data\.gouv\.fr\/datasets\//);
      expect(ref.source.url).toMatch(/^https:\/\//);
      expect(ref.source.licence).toMatch(/^Licence Ouverte/);
      expect(ref.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(ref.freshness.readAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(ref.freshness.reviewBefore)).toBeGreaterThan(Date.parse(ref.freshness.readAt));
    }
    expect(postal.source.producer).toBe('La Poste');
    expect(qpv.source.producer).toMatch(/ANCT/);
  });

  it('keeps only current INSEE codes and lists every code it could not match (never re-mapped)', () => {
    const all = Object.values(postal.postalCodes).flat();
    expect(all.every((c) => current.has(/** @type {string} */ (c)))).toBe(true);
    expect(postal.counts.postalCodes).toBe(Object.keys(postal.postalCodes).length);
    expect(postal.counts.unmatchedRows).toBe(postal.unmatched.length);
    expect(postal.counts.postalCodes).toBeGreaterThan(6000);
    for (const [, communes] of qpv.qpv.map((/** @type {any[]} */ q) => [q[0], q[3]])) expect(communes.every((/** @type {string} */ c) => current.has(c))).toBe(true);
    expect(qpv.counts.quartiers).toBe(qpv.qpv.length);
    expect(qpv.qpv.length).toBeGreaterThan(1500);
  });
});

describe('R46 P07 resolvePostalCode: never the first candidate, inside / outside, QPV at commune level only', () => {
  it('67100 is Strasbourg only, inside the Eurométropole, with its 2024 QPV (Hautepierre is QN06710I in the official list)', () => {
    const r = resolvePostalCode('67100');
    expect(r.status).toBe('SINGLE');
    expect(r.candidates).toHaveLength(1);
    const [c] = /** @type {any[]} */ (r.candidates);
    expect(c).toMatchObject({ code: '67482', nom: 'Strasbourg', departement: '67', inServiceTerritory: true });
    expect(c.quartiersPrioritaires).toContainEqual({ code: 'QN06710I', libelle: 'Hautepierre' });
    expect(r.qpvScope).toBe('COMMUNE_ONLY');
    expect(r.officialQpvLookup).toBe('https://sig.ville.gouv.fr');
    expect(r.source).toMatchObject({ producer: 'La Poste', licence: expect.stringMatching(/Licence Ouverte/) });
  });

  it('a code covering several communes is MULTIPLE with every commune in a stable alphabetical order', () => {
    const r = resolvePostalCode('67800');
    expect(r.status).toBe('MULTIPLE');
    expect(r.candidates?.map((c) => c.nom)).toEqual(['Bischheim', 'Hœnheim']);
    expect(r.candidates?.every((c) => c.inServiceTerritory)).toBe(true);
    expect(r.candidates?.find((c) => c.nom === 'Bischheim')?.quartiersPrioritaires.map((q) => q.code)).toEqual(['QN06704I', 'QN06705I']);
  });

  it('a mixed code says which communes are inside and which are outside the service territory', () => {
    const r = resolvePostalCode('67640');
    expect(r.status).toBe('MULTIPLE');
    const inside = r.candidates?.filter((c) => c.inServiceTerritory).map((c) => c.code).sort();
    expect(inside).toEqual(['67137', '67268']);
    expect(r.candidates?.some((c) => !c.inServiceTerritory)).toBe(true);
    expect(r.serviceTerritory).toEqual({ label: 'Eurométropole de Strasbourg', anyCandidateInside: true });
  });

  it('outside the territory: resolved but marked outside (Paris 75001 → its arrondissement)', () => {
    const r = resolvePostalCode('75001');
    expect(r.status).toBe('SINGLE');
    expect(r.candidates?.[0]).toMatchObject({ code: '75101', inServiceTerritory: false });
    expect(r.serviceTerritory?.anyCandidateInside).toBe(false);
  });

  it('invalid and unknown inputs are said, never guessed', () => {
    for (const bad of ['', '6710', '671000', 'abcde', null, undefined, '67 1OO']) expect(resolvePostalCode(/** @type {any} */ (bad)).status).toBe('INVALID');
    expect(resolvePostalCode('67 100').status).toBe('SINGLE');   // a space is tolerated
    expect(resolvePostalCode('00000').status).toBe('UNKNOWN_POSTAL_CODE');
  });

  it('a missing reference file is UNAVAILABLE, not an empty answer', () => {
    expect(resolvePostalCode('67100', { root: '/nonexistent-root' }).status).toBe('UNAVAILABLE');
    resetPostalReferenceCache();
    expect(qpvForCommune('67482', { root: '/nonexistent-root' }).status).toBe('UNAVAILABLE');
  });

  it('qpvForCommune: a commune without QPV answers an empty list, never « not in a QPV » for an address', () => {
    expect(qpvForCommune('67001')).toMatchObject({ status: 'OK', quartiers: [], qpvScope: 'COMMUNE_ONLY' });
    expect(qpvForCommune('67482').quartiers?.length).toBeGreaterThan(10);
    expect(qpvForCommune('x').status).toBe('INVALID');
  });

  it('freshness turns REVIEW_DUE after the review date', () => {
    expect(postalReferenceFreshness(new Date('2026-11-06T00:00:00Z')).status).toBe('FRESH');
    expect(postalReferenceFreshness(new Date('2027-06-01T00:00:00Z')).status).toBe('REVIEW_DUE');
  });
});

describe('R46 P07 GET /api/territory/*', () => {
  it('answers the lookups with a public cache header and the documented statuses', async () => {
    const ok = await call('/api/territory/postal?code=67800');
    expect(ok.statusCode).toBe(200);
    expect(ok.body.status).toBe('MULTIPLE');
    expect(ok.headers['Cache-Control']).toBe('public, max-age=300');
    expect((await call('/api/territory/postal?code=12')).statusCode).toBe(400);
    expect((await call('/api/territory/postal?code=00000')).body.status).toBe('UNKNOWN_POSTAL_CODE');
    const q = await call('/api/territory/qpv?commune=67447');
    expect(q.statusCode).toBe(200);
    expect(q.body.quartiers.map((/** @type {any} */ x) => x.code)).toEqual(['QN06704I', 'QN06707I', 'QN06721N']);
    expect((await call('/api/territory/qpv?commune=bad')).statusCode).toBe(400);
  });

  it('refuses writes and honours the rate limit', async () => {
    expect((await call('/api/territory/postal?code=67100', 'POST')).statusCode).toBe(405);
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValueOnce(/** @type {any} */ ({ allowed: false, error: { error: 'x' } }));
    expect((await call('/api/territory/postal?code=67100')).statusCode).toBe(429);
  });

  it('is a read-only public route in the restricted beta (GET only)', () => {
    const env = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
    expect(isAllowedInPublicBeta('GET', 'territory/postal', env)).toBe(true);
    expect(isAllowedInPublicBeta('GET', 'territory/qpv', env)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'territory/postal', env)).toBe(false);
  });
});
