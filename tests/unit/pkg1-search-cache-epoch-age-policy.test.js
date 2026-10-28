// PKG-1 — (1) a record that stops being public must disappear from cached search results at once (content epoch); (2) age policy is data and invents no legal threshold.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async get(k) { return store.has(k) ? store.get(k) : null; }
    async set(k, v) { store.set(k, v); return 'OK'; }
    async setex(k, _ttl, v) { store.set(k, v); return 'OK'; }
    async incr(k) { const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; }
  },
}));

describe('search cache content epoch', () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    process.env.KV_REST_API_URL = 'https://kv.invalid';
    process.env.KV_REST_API_TOKEN = 'x';
  });
  it('a bump makes the next identical search miss the cache and re-run the query', async () => {
    const { cachedSearch, bumpContentEpoch } = await import('../../api/lib/search-cache.js');
    const fn = vi.fn(async () => ({ items: [fn.mock.calls.length] }));
    const a = await cachedSearch({ query: 'logement' }, fn);
    const b = await cachedSearch({ query: 'logement' }, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b.cached).toBe(true);
    expect(a.data).toEqual(b.data);
    expect(await bumpContentEpoch()).toEqual({ bumped: true });
    const c = await cachedSearch({ query: 'logement' }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(c.cached).toBe(false);
  });
  it('without a configured cache a bump is a reported no-op, never an error', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const { bumpContentEpoch } = await import('../../api/lib/search-cache.js');
    expect(await bumpContentEpoch()).toEqual({ bumped: false });
  });
});

describe('age policy', () => {
  it('public information is open to every age under the default policy, including minors', async () => {
    const { evaluateAge } = await import('../../api/lib/agePolicy.js');
    for (const band of ['moins-de-18', '18-24', '25-59', '60-et-plus', null, undefined, 'junk']) expect(evaluateAge(band).publicInformation).toBe(true);
  });
  it('the default policy declares itself unvalidated and holds back only sensitive account features for minors', async () => {
    const { evaluateAge, DEFAULT_AGE_POLICY } = await import('../../api/lib/agePolicy.js');
    expect(DEFAULT_AGE_POLICY.status).toBe('REQUIRES_LEGAL_VALIDATION');
    expect(evaluateAge('moins-de-18')).toMatchObject({ accountFeatures: 'POLICY_PENDING', allowed: false, policyStatus: 'REQUIRES_LEGAL_VALIDATION' });
    expect(evaluateAge('18-24').allowed).toBe(true);
  });
  it('no declaration means nothing is inferred', async () => {
    const { evaluateAge } = await import('../../api/lib/agePolicy.js');
    expect(evaluateAge(null)).toMatchObject({ allowed: true, accountFeatures: 'ALLOWED' });
  });
  it('a configured policy replaces the default only when complete and decisive', async () => {
    const { loadAgePolicy, evaluateAge } = await import('../../api/lib/agePolicy.js');
    const bands = { 'moins-de-18': { account: 'GUARDIAN_CONSENT_REQUIRED' }, '18-24': { account: 'ALLOWED' }, '25-59': { account: 'ALLOWED' }, '60-et-plus': { account: 'ALLOWED' } };
    const policy = loadAgePolicy({ ADA_AGE_POLICY_JSON: JSON.stringify({ status: 'CONFIGURED', version: 'dpo-2027-01', bands }) });
    expect(policy.status).toBe('CONFIGURED');
    expect(evaluateAge('moins-de-18', { policy }).allowed).toBe(false);
    expect(evaluateAge('moins-de-18', { policy, guardianVerified: true }).allowed).toBe(true);
    // incomplete / pending / malformed / wrong status → the safe default
    const bad = [{ status: 'CONFIGURED', version: 'v', bands: { ...bands, '25-59': undefined } }, { status: 'CONFIGURED', version: 'v', bands: { ...bands, 'moins-de-18': { account: 'POLICY_PENDING' } } }, { status: 'DRAFT', version: 'v', bands }];
    for (const b of bad) expect(loadAgePolicy({ ADA_AGE_POLICY_JSON: JSON.stringify(b) }).status).toBe('REQUIRES_LEGAL_VALIDATION');
    expect(loadAgePolicy({ ADA_AGE_POLICY_JSON: '{not json' }).status).toBe('REQUIRES_LEGAL_VALIDATION');
  });
  it('the code embeds no numeric legal age threshold', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../api/lib/agePolicy.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/\b(1[3-8])\b\s*(ans|years|<|>|>=|<=)/);
  });
});
