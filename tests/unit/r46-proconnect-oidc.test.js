/**
 * R46 / N09 — ProConnect OIDC adapter against a LOCAL MOCK issuer (in-process: real RSA / EC keys, real JWS signatures, no network, no credential).
 * Proves: DISCONNECTED until configured; discovery validation; state + nonce + PKCE S256; ID token checks (alg, kid, signature, iss, aud/azp, exp, iat, nonce);
 * signed userinfo with the same subject; GET retried once, code exchange never; ProConnect only identifies — no account creation, an ACTIVE invited account
 * with the ADA second factor is required, the result is the same MFA-pending step as a password; never a token in a URL; the federation logout.
 */
import crypto from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const audits = vi.hoisted(() => []);
vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: async (v) => { audits.push(v); } }), execute: async () => { throw new Error('default db must not be used'); } } }));

process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

const ISSUER = 'https://proconnect.lab.invalid/api/v2';
const CLIENT = 'ada-pro-lab-client';
const REDIRECT = 'https://ada.lab.invalid/api/pro/auth/proconnect/callback';
const ENV = { PROCONNECT_ENABLED: 'true', PROCONNECT_ISSUER: ISSUER, PROCONNECT_CLIENT_ID: CLIENT, PROCONNECT_CLIENT_SECRET: 'lab-secret-not-real', PROCONNECT_REDIRECT_URI: REDIRECT,
  PROCONNECT_POST_LOGOUT_REDIRECT_URI: 'https://ada.lab.invalid/pro/login' };

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkOf = (k, kid, alg) => ({ ...k.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload, { alg = 'RS256', kid = 'rsa-1', key = rsa.privateKey, header = {}, ...extra } = {}) {
  const h = b64({ alg, kid, typ: 'JWT', ...header }); const p = b64(payload); const input = `${h}.${p}`;
  if (alg === 'none') return `${input}.${extra.noneSig ? 'AAAA' : ''}`;
  if (alg === 'HS256') return `${input}.${crypto.createHmac('sha256', 'x').update(input).digest('base64url')}`;
  const sig = alg === 'ES256' ? crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }) : crypto.sign('sha256', Buffer.from(input), key);
  return `${input}.${sig.toString('base64url')}`;
}

/** the mock issuer: answers discovery, JWKS, token, userinfo; records calls */
function mockIssuer(o = {}) {
  const calls = []; let lastNonce = null; let lastChallenge = null;
  const meta = { issuer: o.metaIssuer || ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`,
    userinfo_endpoint: `${ISSUER}/userinfo`, end_session_endpoint: `${ISSUER}/session/end`, code_challenge_methods_supported: ['S256'], ...(o.meta || {}) };
  const now = () => Math.floor(Date.now() / 1000);
  let jwksKeys = o.jwks || [jwkOf(rsa, 'rsa-1', 'RS256'), jwkOf(ec, 'ec-1', 'ES256')];
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const u = new URL(url); calls.push({ path: u.pathname, method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    if (u.pathname.endsWith('/.well-known/openid-configuration')) {
      if (o.discovery5xxOnce && calls.filter((c) => c.path.endsWith('openid-configuration')).length === 1) return new Response('', { status: 503 });
      return Response.json(meta);
    }
    if (u.pathname.endsWith('/jwks')) { const r = Response.json({ keys: jwksKeys }); if (o.rotateAfterFirstJwks) jwksKeys = [...jwksKeys, jwkOf(other, 'rsa-2', 'RS256')]; return r; }
    if (u.pathname.endsWith('/token')) {
      if (o.token5xx) return new Response('{"error":"server"}', { status: 502 });
      const form = new URLSearchParams(String(init.body));
      const verifier = form.get('code_verifier');
      if (!verifier || crypto.createHash('sha256').update(verifier).digest('base64url') !== lastChallenge) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (form.get('client_secret') !== ENV.PROCONNECT_CLIENT_SECRET || form.get('redirect_uri') !== REDIRECT) return Response.json({ error: 'invalid_client' }, { status: 401 });
      const claims = { iss: ISSUER, aud: CLIENT, sub: 'pc-sub-0001', exp: now() + 60, iat: now(), nonce: lastNonce, acr: 'eidas1', ...(o.idClaims || {}) };
      return Response.json({ token_type: 'Bearer', access_token: 'at-lab', id_token: sign(claims, { ...(o.idSign || {}), noneSig: o.noneSig }) });
    }
    if (u.pathname.endsWith('/userinfo')) {
      const info = { sub: 'pc-sub-0001', email: o.email || 'Agent.Pro@example.test', given_name: 'Agent', usual_name: 'Test', siret: '12345678901234', ...(o.userinfo || {}) };
      if (o.userinfoJson) return Response.json(info);
      return new Response(sign({ iss: ISSUER, aud: CLIENT, ...info }), { status: 200, headers: { 'content-type': 'application/jwt' } });
    }
    return new Response('', { status: 404 });
  });
  return { fetchImpl, calls, authorize(location) { const u = new URL(location); lastNonce = u.searchParams.get('nonce'); lastChallenge = u.searchParams.get('code_challenge'); return u; } };
}

/** a database stub: the ProUser rows of the e-mail; any write fails the test */
function stubDb(rows) {
  const dialect = new PgDialect(); const seen = [];
  return { seen, execute: async (q) => { const { sql: text, params } = dialect.sqlToQuery(q); seen.push(text);
    if (/insert|update|delete/i.test(text)) throw new Error('no write allowed');
    if (text.includes('lower(email)')) return { rows: rows.filter((r) => r.email.toLowerCase() === params[0]) };
    if (text.includes(' IN (')) return { rows: rows.filter((r) => params.includes(r.id)).map((r) => ({ ...r, hasSecret: r.hasSecret !== false })) };
    return { rows: [] }; } };
}
const mkRes = () => ({ statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, end() { return this; } });
const cookiesOf = (res) => [].concat(res.headers['Set-Cookie'] || []);
const jar = (res) => cookiesOf(res).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

let mod, lib, auth;
beforeAll(async () => {
  mod = await import('../../api/_handlers/pro/auth/proconnect.js');
  lib = await import('../../api/lib/proconnect-oidc.js');
  auth = await import('../../api/_utils/auth.js');
});
beforeEach(() => { lib._resetProConnectCaches(); audits.length = 0; });

let ipN = 0; let fixedIp = null;   // one documentation address per test (the real limiter, 20 per IP per 15 min, applies)
beforeEach(() => { ipN += 1; });
const call = async (path, { method = 'GET', cookie = '', body, env = ENV, issuer, db } = {}) => {
  const res = mkRes();
  await mod.proConnectHandler({ method, url: path, headers: { cookie, 'x-forwarded-for': fixedIp || `198.51.100.${ipN}` }, body }, res, { envVars: env, fetchImpl: issuer?.fetchImpl, db });
  return res;
};
/** start → mock authorize → callback; returns the callback answer and the browser cookies */
async function signIn(issuer, db, { stateOverride, extraQuery = '' } = {}) {
  const start = await call('/api/pro/auth/proconnect/start?next=/pro/cases', { issuer, db });
  expect(start.statusCode).toBe(302);
  const authz = issuer.authorize(start.headers.Location);
  const state = stateOverride ?? authz.searchParams.get('state');
  const cb = await call(`/api/pro/auth/proconnect/callback?code=lab-code&state=${encodeURIComponent(state)}${extraQuery}`, { issuer, db, cookie: jar(start) });
  return { start, authz, cb };
}
const outcome = (res) => new URL(res.headers.Location, 'https://ada.lab.invalid').searchParams.get('proconnect');
const USER = { id: 'pu-1', email: 'agent.pro@example.test', structureId: 'st-1', status: 'active', mfaEnabled: true, name: 'Structure LAB' };

describe('R46 N09 ProConnect — disconnected until configured', () => {
  it('status says DISCONNECTED and names only the missing variables; start/callback go back to the sign-in page; complete is refused', async () => {
    const st = await call('/api/pro/auth/proconnect/status', { env: {} });
    expect(st.body).toEqual({ provider: 'proconnect', status: 'DISCONNECTED', available: false, missing: lib.PROCONNECT_REQUIRED_ENV.slice(), invalid: [] });
    const s = await call('/api/pro/auth/proconnect/start', { env: {} });
    expect(s.statusCode).toBe(302); expect(outcome(s)).toBe('disconnected');
    expect((await call('/api/pro/auth/proconnect/complete', { method: 'POST', env: {} })).statusCode).toBe(503);
    expect((await call('/api/pro/auth/proconnect/status', {})).body).toMatchObject({ status: 'CONFIGURED', available: true });
  });
  it('config: http issuer only on a loopback host outside production; scopes must keep openid and email; ENABLED must be exactly true', () => {
    expect(lib.proConnectConfig({ ...ENV, PROCONNECT_ISSUER: 'http://127.0.0.1:9999' }).configured).toBe(true);
    expect(lib.proConnectConfig({ ...ENV, PROCONNECT_ISSUER: 'http://127.0.0.1:9999', VERCEL_ENV: 'production' }).invalid).toContain('PROCONNECT_ISSUER');
    expect(lib.proConnectConfig({ ...ENV, PROCONNECT_ISSUER: 'http://idp.example.test' }).configured).toBe(false);
    expect(lib.proConnectConfig({ ...ENV, PROCONNECT_SCOPES: 'openid profile' }).invalid).toContain('PROCONNECT_SCOPES');
    expect(lib.proConnectConfig({ ...ENV, PROCONNECT_ENABLED: '1' }).configured).toBe(false);
  });
});

describe('R46 N09 ProConnect — the authorization-code flow against the mock issuer', () => {
  it('happy path: PKCE S256 + state + nonce; the callback hands off through an HttpOnly cookie (no token in any URL); complete = the ADA MFA step', async () => {
    const issuer = mockIssuer(); const db = stubDb([USER]);
    const { start, authz, cb } = await signIn(issuer, db);
    expect(authz.origin + authz.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(authz.searchParams)).toMatchObject({ response_type: 'code', client_id: CLIENT, redirect_uri: REDIRECT, code_challenge_method: 'S256', scope: lib.DEFAULT_SCOPES });
    expect(authz.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(authz.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookiesOf(start)[0]).toMatch(/^ada_pc_state=.+; Path=\/api\/pro\/auth\/proconnect; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    expect(cb.statusCode).toBe(302); expect(outcome(cb)).toBe('continue');
    expect(cb.headers.Location).toBe('/pro/login?proconnect=continue&next=%2Fpro%2Fcases');
    expect(cookiesOf(cb).some((c) => c.startsWith('ada_pc_handoff=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookiesOf(cb).some((c) => c.startsWith('ada_pc_state=;') && c.includes('Max-Age=0'))).toBe(true);
    const done = await call('/api/pro/auth/proconnect/complete', { method: 'POST', issuer, db, cookie: jar(cb) });
    expect(done.statusCode).toBe(200); expect(done.body.mfa_required).toBe(true); expect(done.body).not.toHaveProperty('token');
    expect(auth.verifyProMfaPendingToken(done.body.mfa_token)).toMatchObject({ userId: 'pu-1' });
    expect(auth.verifyProToken(done.body.mfa_token), 'a pending token is never a session').toBeNull();
    expect(cookiesOf(done)[0]).toMatch(/^ada_pc_handoff=; .*Max-Age=0/);
    expect(db.seen.every((q) => /^select/i.test(q.trim()))).toBe(true);
    expect(issuer.calls.filter((c) => c.path.endsWith('/token'))).toHaveLength(1);
    const txt = JSON.stringify(audits);
    expect(txt).not.toMatch(/lab-code|at-lab|eyJ|agent\.pro@/i);
    expect(audits.map((a) => a.action)).toEqual(['PROCONNECT_IDENTIFIED', 'MFA_CHALLENGE']);
  });

  it('a forged or missing state, a state of another browser, or an expired cookie: refused before any code exchange', async () => {
    const issuer = mockIssuer(); const db = stubDb([USER]);
    const { cb } = await signIn(issuer, db, { stateOverride: 'forged-state' });
    expect(outcome(cb)).toBe('failed');
    const noCookie = await call('/api/pro/auth/proconnect/callback?code=x&state=y', { issuer, db });
    expect(outcome(noCookie)).toBe('failed');
    expect(issuer.calls.some((c) => c.path.endsWith('/token'))).toBe(false);
  });

  it('cancelled at the federation (error=access_denied): back to sign-in, its text never echoed', async () => {
    const issuer = mockIssuer(); const { cb } = await signIn(issuer, stubDb([USER]), { extraQuery: '&error=access_denied&error_description=%3Cscript%3E' });
    expect(outcome(cb)).toBe('cancelled'); expect(cb.headers.Location).not.toContain('script');
  });

  it.each([
    ['alg none (unsigned: refused as malformed)', { idSign: { alg: 'none' } }, 'JWT_MALFORMED'],
    ['alg none with a dummy signature', { idSign: { alg: 'none' }, noneSig: true }, 'JWT_ALG_REFUSED'],
    ['alg HS256 (a shared-secret forgery)', { idSign: { alg: 'HS256' } }, 'JWT_ALG_REFUSED'],
    ['a key not in the JWKS', { idSign: { kid: 'rsa-9', key: other.privateKey } }, 'JWT_KEY_UNKNOWN'],
    ['a known kid but another key', { idSign: { kid: 'rsa-1', key: other.privateKey } }, 'JWT_SIGNATURE_INVALID'],
    ['another issuer', { idClaims: { iss: 'https://evil.example.test' } }, 'JWT_ISSUER_INVALID'],
    ['another audience', { idClaims: { aud: 'someone-else' } }, 'JWT_AUDIENCE_INVALID'],
    ['several audiences without our azp', { idClaims: { aud: [CLIENT, 'other'], azp: 'other' } }, 'JWT_AUDIENCE_INVALID'],
    ['expired', { idClaims: { exp: Math.floor(Date.now() / 1000) - 600 } }, 'JWT_EXPIRED'],
    ['issued in the future', { idClaims: { iat: Math.floor(Date.now() / 1000) + 3600 } }, 'JWT_IAT_INVALID'],
    ['another nonce (replayed ID token)', { idClaims: { nonce: 'replayed-nonce' } }, 'JWT_NONCE_INVALID'],
    ['userinfo of another subject', { userinfo: { sub: 'pc-sub-other' } }, 'USERINFO_SUBJECT_MISMATCH'],
    ['no e-mail', { userinfo: { email: '' } }, 'EMAIL_MISSING'],
  ])('ID token / userinfo refused: %s', async (_, o, code) => {
    const issuer = mockIssuer(o); const db = stubDb([USER]);
    const { cb } = await signIn(issuer, db);
    expect(outcome(cb)).toBe('failed');
    expect(cookiesOf(cb).some((c) => c.startsWith('ada_pc_handoff=') && !c.startsWith('ada_pc_handoff=;'))).toBe(false);
    expect(audits.at(-1)).toMatchObject({ action: 'PROCONNECT_FAILED', details: { reason: code } });
  });

  it('ES256 ID token and a plain-JSON userinfo are accepted; a rotated key is found by one JWKS refetch', async () => {
    const a = mockIssuer({ idSign: { alg: 'ES256', kid: 'ec-1', key: ec.privateKey }, userinfoJson: true });
    expect(outcome((await signIn(a, stubDb([USER]))).cb)).toBe('continue');
    lib._resetProConnectCaches();
    const b = mockIssuer({ rotateAfterFirstJwks: true });
    // the first JWKS has no rsa-2; an unknown kid forces ONE refetch (at most once a minute), which finds the rotated key
    const cfg = lib.proConnectConfig(ENV); const meta = await lib.discover(cfg, { fetchImpl: b.fetchImpl });
    const T = Date.now(); const tok = (t, o) => sign({ iss: ISSUER, aud: CLIENT, sub: 's', exp: Math.floor(t / 1000) + 60, iat: Math.floor(t / 1000), nonce: 'n' }, o);
    await lib.verifyIdToken(tok(T), meta, cfg, { nonce: 'n', fetchImpl: b.fetchImpl, now: T });
    const claims = await lib.verifyIdToken(tok(T + 120000, { kid: 'rsa-2', key: other.privateKey }), meta, cfg, { nonce: 'n', fetchImpl: b.fetchImpl, now: T + 120000 });
    expect(b.calls.filter((c) => c.path.endsWith('/jwks'))).toHaveLength(2);
    expect(claims.sub).toBe('s');
  });

  it('discovery: an issuer mismatch is refused; a 5xx is retried once; the code exchange is never retried', async () => {
    const bad = mockIssuer({ metaIssuer: 'https://other.example.test' });
    const s = await call('/api/pro/auth/proconnect/start', { issuer: bad });
    expect(outcome(s)).toBe('unavailable');
    const flaky = mockIssuer({ discovery5xxOnce: true });
    const s2 = await call('/api/pro/auth/proconnect/start', { issuer: flaky });
    expect(s2.headers.Location).toMatch(/^https:\/\/proconnect\.lab\.invalid\/api\/v2\/authorize\?/);
    lib._resetProConnectCaches();
    const down = mockIssuer({ token5xx: true });
    const { cb } = await signIn(down, stubDb([USER]));
    expect(outcome(cb)).toBe('failed'); expect(down.calls.filter((c) => c.path.endsWith('/token'))).toHaveLength(1);
  });
});

describe('R46 N09 ProConnect — identification only: invited account + ADA second factor required', () => {
  it('no professional account for this e-mail: nothing created, « no_account »', async () => {
    const db = stubDb([]); const { cb } = await signIn(mockIssuer(), db);
    expect(outcome(cb)).toBe('no_account'); expect(db.seen.every((q) => /^select/i.test(q.trim()))).toBe(true);
    expect(audits.at(-1)).toMatchObject({ action: 'PROCONNECT_NO_ACCOUNT', details: { reason: 'NO_INVITED_ACCOUNT' } });
  });
  it('an account still pending (invitation not completed) or disabled: « no_account » (ProConnect never activates an account)', async () => {
    for (const status of ['pending', 'disabled']) { lib._resetProConnectCaches(); const { cb } = await signIn(mockIssuer(), stubDb([{ ...USER, status }])); expect(outcome(cb)).toBe('no_account'); }
  });
  it('an active account without the ADA second factor: « mfa_enrolment_required », no handoff', async () => {
    const { cb } = await signIn(mockIssuer(), stubDb([{ ...USER, mfaEnabled: false }]));
    expect(outcome(cb)).toBe('mfa_enrolment_required');
    expect(cookiesOf(cb).some((c) => /^ada_pc_handoff=[^;]/.test(c))).toBe(false);
  });
  it('several organizations: the person chooses (409), then the chosen one gets the MFA step; a forged handoff is refused', async () => {
    const users = [USER, { ...USER, id: 'pu-2', structureId: 'st-2', name: 'Autre structure LAB' }];
    const db = stubDb(users); const { cb } = await signIn(mockIssuer(), db);
    const choose = await call('/api/pro/auth/proconnect/complete', { method: 'POST', db, cookie: jar(cb) });
    expect(choose.statusCode).toBe(409); expect(choose.body.organizations.map((o) => o.structureId)).toEqual(['st-1', 'st-2']);
    const done = await call('/api/pro/auth/proconnect/complete', { method: 'POST', db, cookie: jar(cb), body: { structureId: 'st-2' } });
    expect(auth.verifyProMfaPendingToken(done.body.mfa_token)).toMatchObject({ userId: 'pu-2' });
    const forged = await call('/api/pro/auth/proconnect/complete', { method: 'POST', db, cookie: `ada_pc_handoff=${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"u":["pu-1"]}').toString('base64url')}.` });   // an unsigned (alg none) forged hand-off, built at run time
    expect(forged.statusCode).toBe(401);
  });
  it('an account disabled between the callback and completion: refused', async () => {
    const db = stubDb([USER]); const { cb } = await signIn(mockIssuer(), db);
    const later = stubDb([{ ...USER, status: 'disabled' }]);
    expect((await call('/api/pro/auth/proconnect/complete', { method: 'POST', db: later, cookie: jar(cb) })).statusCode).toBe(403);
  });
});

describe('R46 N09 ProConnect — rate limit', () => {
  it('more than 20 attempts from one address in 15 minutes: back to sign-in « too_many », the federation is not contacted', async () => {
    fixedIp = '192.0.2.250'; const issuer = mockIssuer();
    try {
      for (let i = 0; i < 20; i += 1) expect((await call('/api/pro/auth/proconnect/start', { issuer })).statusCode).toBe(302);
      const before = issuer.calls.length;
      const r = await call('/api/pro/auth/proconnect/start', { issuer });
      expect(outcome(r)).toBe('too_many'); expect(issuer.calls.length).toBe(before);
    } finally { fixedIp = null; }
  });
});

describe('R46 N09 ProConnect — federation logout', () => {
  it('with the ID token cookie: 302 to end_session with id_token_hint + post_logout_redirect_uri; without: back to sign-in; the cookie is cleared', async () => {
    const issuer = mockIssuer(); const { cb } = await signIn(issuer, stubDb([USER]));
    const idt = cookiesOf(cb).find((c) => c.startsWith('ada_pc_idt=')).split(';')[0];
    const out = await call('/api/pro/auth/proconnect/logout', { issuer, cookie: idt });
    const u = new URL(out.headers.Location);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/session/end`);
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe(ENV.PROCONNECT_POST_LOGOUT_REDIRECT_URI); expect(u.searchParams.get('id_token_hint')).toMatch(/^eyJ/);
    expect(cookiesOf(out)[0]).toMatch(/^ada_pc_idt=; .*Max-Age=0/);
    expect((await call('/api/pro/auth/proconnect/logout', { issuer })).headers.Location).toBe('/pro/login');
  });
});
