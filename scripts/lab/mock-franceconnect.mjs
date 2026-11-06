#!/usr/bin/env node
/**
 * R46 / N08 — a LOCAL mock OpenID Connect provider shaped like FranceConnect v2 (discovery, JWKS, authorize, token, userinfo as a signed JWT, end_session),
 * for LAB tests of api/lib/franceconnect/oidc-client.js. It is NOT FranceConnect and proves nothing about the real service: synthetic identities only,
 * loopback only, auto-approval (no identity provider screen). Fault injection for tests: mock.set({ badSignature, wrongNonce, wrongAudience, expired,
 * userinfoSubMismatch, alg: 'RS256' | 'ES256' | 'none' }).
 *
 *   node scripts/lab/mock-franceconnect.mjs            # listens on 127.0.0.1:${MOCK_FC_PORT:-3110}, prints the issuer
 *   import { startMockFranceConnect } from './scripts/lab/mock-franceconnect.mjs'
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { isMainModule } from '../lib/is-main.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');

/** @param {{ port?: number, clientId?: string, clientSecret?: string, sub?: string, email?: string }} [opts] */
export async function startMockFranceConnect(opts = {}) {
  const clientId = opts.clientId || 'lab-fc-client';
  const clientSecret = opts.clientSecret || 'lab-fc-secret-not-a-real-credential';
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const rsaJwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'lab-rsa-1', use: 'sig', alg: 'RS256' };
  const ecJwk = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'lab-ec-1', use: 'sig', alg: 'ES256' };
  const state = { sub: opts.sub || 'lab-fc-sub-0001', email: opts.email || 'fc.synthetic@example.test', faults: /** @type {Record<string, any>} */ ({}), codes: new Map(), tokens: new Map(), calls: [] };
  let issuer = '';

  const sign = (payload, { alg = state.faults.alg || 'RS256' } = {}) => {
    const header = alg === 'ES256' ? { alg, kid: ecJwk.kid, typ: 'JWT' } : alg === 'none' ? { alg: 'none', typ: 'JWT' } : { alg: 'RS256', kid: rsaJwk.kid, typ: 'JWT' };
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    if (alg === 'none') return `${input}.`;
    let sig = alg === 'ES256' ? crypto.sign('sha256', Buffer.from(input), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }) : crypto.sign('sha256', Buffer.from(input), rsa.privateKey);
    if (state.faults.badSignature) sig = Buffer.from(sig.map((x) => x ^ 0xff));
    return `${input}.${b64u(sig)}`;
  };
  const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => r(Buffer.concat(c).toString('utf8'))); });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    state.calls.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/session/end`, response_types_supported: ['code'], subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256', 'ES256'], code_challenge_methods_supported: ['S256'], acr_values_supported: ['eidas1'] });
    }
    if (u.pathname === '/jwks') return send(res, 200, { keys: [rsaJwk, ecJwk] });
    if (u.pathname === '/authorize') {
      const p = Object.fromEntries(u.searchParams);
      if (p.client_id !== clientId || p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !p.code_challenge || !p.state || !p.nonce || !p.redirect_uri) return send(res, 400, { error: 'invalid_request' });
      if (state.faults.deny) { res.writeHead(302, { Location: `${p.redirect_uri}?error=access_denied&state=${encodeURIComponent(p.state)}` }); return res.end(); }
      const code = b64u(crypto.randomBytes(24));
      state.codes.set(code, { nonce: p.nonce, challenge: p.code_challenge, redirectUri: p.redirect_uri, sub: state.sub, acr: p.acr_values || 'eidas1' });
      res.writeHead(302, { Location: `${p.redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(p.state)}` });
      return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const p = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const c = state.codes.get(p.code);
      state.codes.delete(p.code);   // one use
      if (p.client_id !== clientId || p.client_secret !== clientSecret) return send(res, 401, { error: 'invalid_client' });
      if (!c || p.grant_type !== 'authorization_code' || p.redirect_uri !== c.redirectUri) return send(res, 400, { error: 'invalid_grant' });
      if (b64u(crypto.createHash('sha256').update(String(p.code_verifier || '')).digest()) !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'pkce' });
      const now = Math.floor(Date.now() / 1000);
      const access = b64u(crypto.randomBytes(24));
      state.tokens.set(access, c.sub);
      const idToken = sign({ iss: issuer, sub: c.sub, aud: state.faults.wrongAudience ? 'someone-else' : clientId, exp: state.faults.expired ? now - 3600 : now + 60, iat: state.faults.expired ? now - 3700 : now,
        nonce: state.faults.wrongNonce ? 'not-the-nonce' : c.nonce, acr: c.acr, amr: ['pwd'] });
      return send(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 60, id_token: idToken });
    }
    if (u.pathname === '/userinfo') {
      const sub = state.tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!sub) return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, sign({ iss: issuer, aud: clientId, sub: state.faults.userinfoSubMismatch ? 'other-sub' : sub, email: state.email }), 'application/jwt');
    }
    if (u.pathname === '/session/end') {
      const to = u.searchParams.get('post_logout_redirect_uri');
      if (!u.searchParams.get('id_token_hint') || !to) return send(res, 400, { error: 'invalid_request' });
      res.writeHead(302, { Location: `${to}${to.includes('?') ? '&' : '?'}state=${encodeURIComponent(u.searchParams.get('state') || '')}` });
      return res.end();
    }
    return send(res, 404, { error: 'not_found' });
  });
  await new Promise((r) => { server.listen(opts.port ?? 0, '127.0.0.1', r); });
  issuer = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  return {
    issuer, clientId, clientSecret, calls: state.calls,
    /** @param {Record<string, any>} f */ set(f) { state.faults = { ...f }; },
    /** @param {string} sub */ setSub(sub) { state.sub = sub; },
    close: () => new Promise((r) => { server.close(() => r(undefined)); }),
  };
}

if (isMainModule(import.meta.url)) {
  const mock = await startMockFranceConnect({ port: Number(process.env.MOCK_FC_PORT || 3110), sub: process.env.MOCK_FC_SUB || undefined });
  console.log(JSON.stringify({ issuer: mock.issuer, clientId: mock.clientId }));
}
