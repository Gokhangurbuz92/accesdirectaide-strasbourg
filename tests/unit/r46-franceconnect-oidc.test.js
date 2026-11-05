/**
 * R46 / N08 — FranceConnect OIDC adapter (api/lib/franceconnect/oidc-client.js) against the LOCAL mock provider (scripts/lab/mock-franceconnect.mjs).
 * Not FranceConnect: proves the client side of the protocol (PKCE, state/nonce, signature, claims, userinfo JWT, logout) and its fail-closed configuration.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authorizationUrl, clearOidcCaches, completeAuthorization, endSessionUrl, franceConnectConfig, pkceChallenge, randomToken, checkIdTokenClaims }
  from '../../api/lib/franceconnect/oidc-client.js';
import { startMockFranceConnect } from '../../scripts/lab/mock-franceconnect.mjs';

let mock; let cfg;
const REDIRECT = 'http://127.0.0.1:5182/api/auth/franceconnect/callback';
beforeAll(async () => {
  mock = await startMockFranceConnect();
  cfg = franceConnectConfig({ FRANCECONNECT_ISSUER: mock.issuer, FRANCECONNECT_CLIENT_ID: mock.clientId, FRANCECONNECT_CLIENT_SECRET: mock.clientSecret });
});
afterAll(() => mock.close());
beforeEach(() => { mock.set({}); clearOidcCaches(); });

/** run the browser part: authorize → the provider's redirect → code */
async function authorize(extra = {}) {
  const p = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), redirectUri: REDIRECT, ...extra };
  const url = await authorizationUrl(cfg, p);
  const r = await fetch(url, { redirect: 'manual' });
  const loc = new URL(r.headers.get('location'));
  return { p, url: new URL(url), loc, code: loc.searchParams.get('code') };
}

describe('configuration (fail-closed)', () => {
  it('nothing configured = unavailable; production needs https and the owner approval', () => {
    expect(franceConnectConfig({})).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    const base = { FRANCECONNECT_ISSUER: 'https://fc.example.test', FRANCECONNECT_CLIENT_ID: 'c', FRANCECONNECT_CLIENT_SECRET: 's' };
    expect(franceConnectConfig({ ...base, VERCEL_ENV: 'production' })).toEqual({ ok: false, reason: 'PRODUCTION_NOT_APPROVED' });
    expect(franceConnectConfig({ ...base, VERCEL_ENV: 'production', FRANCECONNECT_PRODUCTION_APPROVED: 'true' }).ok).toBe(true);
    expect(franceConnectConfig({ ...base, FRANCECONNECT_ISSUER: 'http://fc.example.test' })).toEqual({ ok: false, reason: 'ISSUER_NOT_HTTPS' });
    expect(franceConnectConfig({ ...base, FRANCECONNECT_ISSUER: 'http://127.0.0.1:9', VERCEL_ENV: 'preview', FRANCECONNECT_PRODUCTION_APPROVED: 'true' })).toEqual({ ok: false, reason: 'ISSUER_NOT_HTTPS' });
    expect(franceConnectConfig({ ...base, FRANCECONNECT_SCOPES: 'email' })).toEqual({ ok: false, reason: 'SCOPES_INVALID' });
    expect(cfg.ok && cfg.scopes).toBe('openid email');   // minimisation: no identity pivot requested
  });
});

describe('authorization code flow against the mock provider', () => {
  it('authorize carries state, nonce, PKCE S256 and acr; the code completes to a verified identity with the userinfo e-mail', async () => {
    const { p, url, loc, code } = await authorize();
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(p.verifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('acr_values')).toBe('eidas1');
    expect(loc.searchParams.get('state')).toBe(p.state);
    const id = await completeAuthorization(cfg, { code, verifier: p.verifier, nonce: p.nonce, redirectUri: REDIRECT });
    expect(id).toMatchObject({ sub: 'lab-fc-sub-0001', issuer: mock.issuer, acr: 'eidas1', email: 'fc.synthetic@example.test' });
    expect(id.idToken.split('.')).toHaveLength(3);
  });
  it('ES256-signed tokens verify too', async () => {
    mock.set({ alg: 'ES256' });
    const { p, code } = await authorize();
    expect((await completeAuthorization(cfg, { code, verifier: p.verifier, nonce: p.nonce, redirectUri: REDIRECT })).sub).toBe('lab-fc-sub-0001');
  });
  const refused = [
    ['a tampered signature', { badSignature: true }, 'OIDC_JWT_SIGNATURE_INVALID'],
    ['alg none', { alg: 'none' }, 'OIDC_JWT_ALG_NOT_ALLOWED'],
    ['a wrong nonce', { wrongNonce: true }, 'OIDC_ID_TOKEN_NONCE'],
    ['another audience', { wrongAudience: true }, 'OIDC_ID_TOKEN_AUDIENCE'],
    ['an expired ID token', { expired: true }, 'OIDC_ID_TOKEN_EXPIRED'],
    ['a userinfo for another subject', { userinfoSubMismatch: true }, 'OIDC_USERINFO_SUB_MISMATCH'],
  ];
  for (const [label, fault, message] of refused) {
    it(`refuses ${label}`, async () => {
      mock.set(fault);
      const { p, code } = await authorize();
      await expect(completeAuthorization(cfg, { code, verifier: p.verifier, nonce: p.nonce, redirectUri: REDIRECT })).rejects.toThrow(message);
    });
  }
  it('a wrong PKCE verifier, a replayed code and a wrong client secret are refused by the token exchange', async () => {
    const a = await authorize();
    await expect(completeAuthorization(cfg, { code: a.code, verifier: randomToken(), nonce: a.p.nonce, redirectUri: REDIRECT })).rejects.toThrow('OIDC_TOKEN_EXCHANGE_FAILED');
    const b = await authorize();
    await completeAuthorization(cfg, { code: b.code, verifier: b.p.verifier, nonce: b.p.nonce, redirectUri: REDIRECT });
    await expect(completeAuthorization(cfg, { code: b.code, verifier: b.p.verifier, nonce: b.p.nonce, redirectUri: REDIRECT })).rejects.toThrow('OIDC_TOKEN_EXCHANGE_FAILED');
    const c = await authorize();
    await expect(completeAuthorization({ ...cfg, clientSecret: 'wrong' }, { code: c.code, verifier: c.p.verifier, nonce: c.p.nonce, redirectUri: REDIRECT })).rejects.toThrow('OIDC_TOKEN_EXCHANGE_FAILED');
  });
  it('a provider that is down is an error, never a sign-in', async () => {
    const down = franceConnectConfig({ FRANCECONNECT_ISSUER: 'http://127.0.0.1:9', FRANCECONNECT_CLIENT_ID: 'c', FRANCECONNECT_CLIENT_SECRET: 's' });
    await expect(authorizationUrl(down, { state: 's', nonce: 'n', verifier: 'v', redirectUri: REDIRECT })).rejects.toThrow('OIDC_PROVIDER_UNREACHABLE');
  });
  it('RP-initiated logout URL carries the id_token_hint and the post-logout address', async () => {
    const { p, code } = await authorize();
    const id = await completeAuthorization(cfg, { code, verifier: p.verifier, nonce: p.nonce, redirectUri: REDIRECT });
    const u = new URL(await endSessionUrl(cfg, { idToken: id.idToken, state: 'st', postLogoutRedirectUri: 'http://127.0.0.1:5182/' }));
    expect(u.pathname).toBe('/session/end');
    expect(u.searchParams.get('id_token_hint')).toBe(id.idToken);
    const r = await fetch(u, { redirect: 'manual' });
    expect(r.headers.get('location')).toBe('http://127.0.0.1:5182/?state=st');
  });
  it('claims check: issuer, multi-audience azp, iat in the future', () => {
    const now = Date.now(); const s = Math.floor(now / 1000);
    const ok = { iss: 'https://i.example.test', aud: 'c', exp: s + 60, iat: s, nonce: 'n', sub: 'x' };
    expect(checkIdTokenClaims(ok, { issuer: 'https://i.example.test', clientId: 'c', nonce: 'n', now })).toBe(ok);
    expect(() => checkIdTokenClaims({ ...ok, iss: 'https://evil.example.test' }, { issuer: 'https://i.example.test', clientId: 'c', nonce: 'n', now })).toThrow('OIDC_ID_TOKEN_ISSUER');
    expect(() => checkIdTokenClaims({ ...ok, aud: ['c', 'd'] }, { issuer: 'https://i.example.test', clientId: 'c', nonce: 'n', now })).toThrow('OIDC_ID_TOKEN_AUDIENCE');
    expect(() => checkIdTokenClaims({ ...ok, iat: s + 3600 }, { issuer: 'https://i.example.test', clientId: 'c', nonce: 'n', now })).toThrow('OIDC_ID_TOKEN_IAT');
  });
});
