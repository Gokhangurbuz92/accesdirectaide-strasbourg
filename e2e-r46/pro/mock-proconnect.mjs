#!/usr/bin/env node
/**
 * R46 / N09 — a LOCAL mock OpenID Provider standing in for ProConnect in LAB browser tests. Synthetic only: no real federation, no credential, loopback only.
 *   node e2e-r46/pro/mock-proconnect.mjs            (MOCK_PC_PORT, default 5197; issuer http://127.0.0.1:<port>/api/v2)
 * Endpoints: /api/v2/.well-known/openid-configuration, /api/v2/jwks, /api/v2/authorize (consents at once: redirects back with a code), /api/v2/token
 * (checks client, redirect URI and the PKCE verifier), /api/v2/userinfo (signed JWT, like ProConnect), /api/v2/session/end, and a test control
 * POST /__identity { email } choosing the identity of the next sign-in (default MOCK_PC_EMAIL).
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PC_PORT || 5197);
const ISSUER = `http://127.0.0.1:${PORT}/api/v2`;
const CLIENT = process.env.MOCK_PC_CLIENT_ID || 'ada-pro-lab-client';
const SECRET = process.env.MOCK_PC_CLIENT_SECRET || 'lab-secret-not-real';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'mock-rsa-1';
let identity = process.env.MOCK_PC_EMAIL || 'agent@example.test';
/** @type {Map<string, { nonce: string, challenge: string, redirect: string, email: string }>} */ const codes = new Map();
/** @type {Map<string, { email: string, sub: string }>} */ const tokens = new Map();

const b64 = (/** @type {any} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (/** @type {any} */ payload) => { const input = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64(payload)}`; return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`; };
const subOf = (/** @type {string} */ email) => crypto.createHash('sha256').update(`mock:${email}`).digest('hex').slice(0, 32);
const now = () => Math.floor(Date.now() / 1000);
const body = async (/** @type {http.IncomingMessage} */ req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c).toString('utf8'); };
const json = (/** @type {http.ServerResponse} */ res, /** @type {number} */ s, /** @type {any} */ d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };

http.createServer(async (req, res) => {
  const u = new URL(String(req.url), ISSUER);
  const p = u.pathname;
  if (p === '/api/v2/.well-known/openid-configuration') return json(res, 200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`, jwks_uri: `${ISSUER}/jwks`, end_session_endpoint: `${ISSUER}/session/end`, code_challenge_methods_supported: ['S256'],
    id_token_signing_alg_values_supported: ['RS256'], userinfo_signing_alg_values_supported: ['RS256'] });
  if (p === '/api/v2/jwks') return json(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
  if (p === '/__identity' && req.method === 'POST') { identity = String(JSON.parse(await body(req) || '{}').email || identity); return json(res, 200, { ok: true }); }
  if (p === '/api/v2/authorize') {
    const q = Object.fromEntries(u.searchParams);
    if (q.client_id !== CLIENT || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.state || !q.nonce) return json(res, 400, { error: 'invalid_request' });
    const code = crypto.randomBytes(16).toString('hex');
    codes.set(code, { nonce: q.nonce, challenge: q.code_challenge, redirect: q.redirect_uri, email: identity });
    const back = new URL(q.redirect_uri); back.searchParams.set('code', code); back.searchParams.set('state', q.state);
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if (p === '/api/v2/token' && req.method === 'POST') {
    const f = new URLSearchParams(await body(req));
    const c = codes.get(String(f.get('code'))); codes.delete(String(f.get('code')));
    if (!c || f.get('client_id') !== CLIENT || f.get('client_secret') !== SECRET || f.get('redirect_uri') !== c.redirect
      || crypto.createHash('sha256').update(String(f.get('code_verifier'))).digest('base64url') !== c.challenge) return json(res, 400, { error: 'invalid_grant' });
    const sub = subOf(c.email); const at = crypto.randomBytes(16).toString('hex'); tokens.set(at, { email: c.email, sub });
    return json(res, 200, { token_type: 'Bearer', access_token: at, expires_in: 60, id_token: sign({ iss: ISSUER, aud: CLIENT, sub, nonce: c.nonce, iat: now(), exp: now() + 60, acr: 'eidas1' }) });
  }
  if (p === '/api/v2/userinfo') {
    const t = tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!t) return json(res, 401, { error: 'invalid_token' });
    res.writeHead(200, { 'content-type': 'application/jwt' });
    return res.end(sign({ iss: ISSUER, aud: CLIENT, sub: t.sub, email: t.email, given_name: 'Agent', usual_name: 'Fictif', siret: '00000000000000' }));
  }
  if (p === '/api/v2/session/end') { res.writeHead(302, { location: String(u.searchParams.get('post_logout_redirect_uri') || '/') }); return res.end(); }
  return json(res, 404, { error: 'not_found' });
}).listen(PORT, '127.0.0.1', () => console.log(`mock ProConnect issuer ${ISSUER}`));
