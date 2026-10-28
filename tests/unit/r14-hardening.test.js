/**
 * R14 — defects found by the review of surfaces already green (27/10/2026): a document name above U+00FF made the download throw; a person under a processing
 * restriction could still create a live share link; a failed search section was cached as « no result »; an attested local site was an authority on the
 * rules of a national aide. Pure / mocked units; the veille's person decisions are covered on real PostgreSQL (veille-hardening-db).
 */
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ citizen: null, restricted: false, created: 0, store: new Map(), sets: 0 }));
vi.mock('../../api/_utils/citizen-auth.js', () => ({ resolveCitizen: async () => S.citizen }));
vi.mock('../../api/_services/processing-restriction.js', () => ({ isRestricted: async () => S.restricted }));
vi.mock('@upstash/redis', () => ({ Redis: class { async get(k) { return S.store.get(k) ?? null; } async set(k, v) { S.sets += 1; S.store.set(k, v); return 'OK'; } async incr() { return 1; } } }));

const mkRes = () => ({ statusCode: 200, headers: {}, body: undefined, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const req = (ip) => ({ method: 'POST', url: '/api/share/create', query: {}, body: {}, headers: { host: 'localhost', 'x-forwarded-for': ip }, socket: { remoteAddress: ip } });
afterEach(() => { S.citizen = null; S.restricted = false; S.created = 0; vi.unstubAllEnvs(); });

describe('R14: downloads with any document name', () => {
  it('a Unicode name (œ, Cyrillic, emoji) gives a header Node accepts, with the exact name in filename* and an ASCII fallback', async () => {
    const { attachmentDisposition } = await import('../../api/_utils/content-disposition.js');
    const h = attachmentDisposition('sœur — Привет 😀.pdf');
    const res = new http.ServerResponse(new http.IncomingMessage(null));
    expect(() => res.setHeader('Content-Disposition', h)).not.toThrow();
    expect(h).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(decodeURIComponent(h.split("UTF-8''")[1])).toBe('sœur — Привет 😀.pdf');
    expect(attachmentDisposition('a"b\\c\r\n.pdf')).not.toMatch(/[\r\n]|filename="[^"]*"[^;]/);
  });
});

describe('R14: no new share while processing is restricted (art. 18)', () => {
  const handler = async () => (await import('../../api/_utils/share-create-limit.js')).withShareCreateLimit(async (_q, res) => { S.created += 1; return res.status(200).json({ ok: true }); });
  it('a restricted signed-in person is refused (409 PROCESSING_RESTRICTED) and create.js is never called; unrestricted or anonymous goes through', async () => {
    const h = await handler();
    S.citizen = { id: 'c1' }; S.restricted = true;
    const r1 = mkRes(); await h(req('198.51.100.1'), r1);
    expect(r1.statusCode).toBe(409); expect(r1.body.code).toBe('PROCESSING_RESTRICTED'); expect(S.created).toBe(0);
    S.restricted = false; const r2 = mkRes(); await h(req('198.51.100.2'), r2); expect(r2.statusCode).toBe(200);
    S.citizen = null; S.restricted = true; const r3 = mkRes(); await h(req('198.51.100.3'), r3); expect(r3.statusCode).toBe(200);
    expect(S.created).toBe(2);
  });
});

describe('R14: a failed search section is never cached', () => {
  it('a result with partial sections is returned but not stored; a complete one is stored', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example.test'); vi.stubEnv('KV_REST_API_TOKEN', 'x');
    vi.resetModules();
    const { cachedSearch } = await import('../../api/lib/search-cache.js');
    S.sets = 0;
    const a = await cachedSearch({ query: 'r14-partial' }, async () => ({ items: [], demarches: [], partial: ['demarches'] }));
    expect(a.data.partial).toEqual(['demarches']);
    const setsAfterPartial = S.sets;
    await cachedSearch({ query: 'r14-complete' }, async () => ({ items: [{ id: 1 }], demarches: [] }));
    expect(S.sets).toBeGreaterThan(setsAfterPartial);
    // the partial query is computed again next time (nothing was stored for it)
    let calls = 0; await cachedSearch({ query: 'r14-partial' }, async () => { calls += 1; return { items: [] }; });
    expect(calls).toBe(1);
  });
});

describe('R14: an attested local site is a local authority only', () => {
  it('« :local » capabilities never decide a NATIONAL record; they do for a local one; a full capability is unchanged', async () => {
    vi.resetModules();
    const { authorityFor } = await import('../../api/_services/verification/chain.js');
    const { ATTESTED_CAPABILITIES } = await import('../../api/_services/verification/sources.js');
    expect(ATTESTED_CAPABILITIES).toEqual(['structures', 'aides:local', 'demarches:local']);
    const ctx = { registry: [{ sourceId: 'annuaire-site:mairie.example.fr', trustedDomains: ['mairie.example.fr'], capabilities: ATTESTED_CAPABILITIES, level: 'COMMUNE' },
      { sourceId: 'caf', trustedDomains: ['caf.fr'], capabilities: ['aides', 'demarches'], level: 'NATIONAL' }] };
    expect(authorityFor(ctx, 'https://mairie.example.fr/aides/apl', 'aide', { territory_scope: 'NATIONAL' })).toMatchObject({ ok: false });
    expect(authorityFor(ctx, 'https://mairie.example.fr/aides/cantine', 'aide', { territory_scope: 'COMMUNAL' })).toMatchObject({ ok: true });
    expect(authorityFor(ctx, 'https://www.caf.fr/apl', 'aide', { territory_scope: 'NATIONAL' })).toMatchObject({ ok: true });
  });
});
