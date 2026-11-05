// @ts-check
/**
 * R46 / N08 (C26) — FranceConnect OIDC adapter, software side only. Standard OpenID Connect authorization-code flow with PKCE (S256), state and nonce,
 * signed ID token (RS256 / ES256 via the provider's JWKS; HS256 with the client secret, as FranceConnect v1 did), userinfo as JSON or as a signed JWT,
 * RP-initiated logout (end_session_endpoint with id_token_hint).
 *
 * NOT LIVE. No FranceConnect credentials exist; FranceConnect needs a DataPass habilitation of the controller and the provider's own qualification.
 * In the LAB the adapter runs against a local mock provider (scripts/lab/mock-franceconnect.mjs). In production / preview it stays unavailable unless the
 * owner sets FRANCECONNECT_PRODUCTION_APPROVED=true after the habilitation (and the capability citizen.franceconnect is opened: outside the first AIPD).
 *
 * Configuration (names only):
 *   FRANCECONNECT_ISSUER                 issuer URL; discovery at <issuer>/.well-known/openid-configuration (https; http only to loopback outside production)
 *   FRANCECONNECT_CLIENT_ID / _SECRET    the RP credentials issued after habilitation (secret: server only)
 *   FRANCECONNECT_REDIRECT_URI           default <APP_BASE_URL>/api/auth/franceconnect/callback
 *   FRANCECONNECT_POST_LOGOUT_REDIRECT_URI default <APP_BASE_URL>/
 *   FRANCECONNECT_SCOPES                 default « openid email » (minimisation: the account already exists; no identity pivot is requested)
 *   FRANCECONNECT_ACR_VALUES             default « eidas1 »
 *   FRANCECONNECT_PRODUCTION_APPROVED    true only after habilitation (owner)
 */
import crypto from 'node:crypto';

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const CLOCK_SKEW_S = 120;

export class OidcError extends Error {
  /** @param {string} code */
  constructor(code) { super(`OIDC_${code}`); this.name = 'OidcError'; this.code = code; }
}

/** @param {Record<string, string | undefined>} envVars */
const deployed = (envVars) => ['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase());

/**
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {{ ok: true, issuer: string, clientId: string, clientSecret: string, redirectUri: string | null, postLogoutRedirectUri: string | null, scopes: string, acr: string }
 *   | { ok: false, reason: string }}
 */
export function franceConnectConfig(envVars = process.env) {
  const issuer = flag(envVars.FRANCECONNECT_ISSUER).replace(/\/+$/, '');
  const clientId = flag(envVars.FRANCECONNECT_CLIENT_ID);
  const clientSecret = flag(envVars.FRANCECONNECT_CLIENT_SECRET);
  if (!issuer || !clientId || !clientSecret) return { ok: false, reason: 'NOT_CONFIGURED' };
  let u;
  try { u = new URL(issuer); } catch { return { ok: false, reason: 'ISSUER_INVALID' }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !deployed(envVars))) return { ok: false, reason: 'ISSUER_NOT_HTTPS' };
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: 'ISSUER_INVALID' };
  if (deployed(envVars) && flag(envVars.FRANCECONNECT_PRODUCTION_APPROVED).toLowerCase() !== 'true') return { ok: false, reason: 'PRODUCTION_NOT_APPROVED' };
  const scopes = flag(envVars.FRANCECONNECT_SCOPES) || 'openid email';
  if (!scopes.split(/\s+/).includes('openid')) return { ok: false, reason: 'SCOPES_INVALID' };
  return { ok: true, issuer, clientId, clientSecret, redirectUri: flag(envVars.FRANCECONNECT_REDIRECT_URI) || null,
    postLogoutRedirectUri: flag(envVars.FRANCECONNECT_POST_LOGOUT_REDIRECT_URI) || null, scopes, acr: flag(envVars.FRANCECONNECT_ACR_VALUES) || 'eidas1' };
}

const b64u = (/** @type {Buffer} */ b) => b.toString('base64url');
export const randomToken = () => b64u(crypto.randomBytes(32));
export const pkceChallenge = (/** @type {string} */ verifier) => b64u(crypto.createHash('sha256').update(verifier).digest());

/** @type {Map<string, { at: number, doc: any }>} */
const discoveryCache = new Map();
/** @type {Map<string, { at: number, keys: any[] }>} */
const jwksCache = new Map();
const CACHE_MS = 10 * 60 * 1000;

/** @param {typeof fetch} doFetch @param {string} url @param {RequestInit} [init] */
async function fetchJson(doFetch, url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await doFetch(url, { ...init, signal: ctl.signal, redirect: 'error' });
    const text = await res.text();
    return { status: res.status, contentType: String(res.headers.get('content-type') || ''), text };
  } catch { throw new OidcError('PROVIDER_UNREACHABLE'); } finally { clearTimeout(t); }
}

/** @param {string} issuer @param {{ fetchImpl?: typeof fetch, fresh?: boolean }} [opts] */
export async function discover(issuer, opts = {}) {
  const hit = discoveryCache.get(issuer);
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_MS) return hit.doc;
  const r = await fetchJson(opts.fetchImpl || fetch, `${issuer}/.well-known/openid-configuration`);
  if (r.status !== 200) throw new OidcError('DISCOVERY_FAILED');
  let doc; try { doc = JSON.parse(r.text); } catch { throw new OidcError('DISCOVERY_FAILED'); }
  // the document must be the issuer's own (OIDC Discovery § 4.3) and every endpoint on the issuer's origin
  if (doc?.issuer?.replace(/\/+$/, '') !== issuer) throw new OidcError('DISCOVERY_ISSUER_MISMATCH');
  const origin = new URL(issuer).origin;
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof doc[k] !== 'string' || new URL(doc[k]).origin !== origin) throw new OidcError('DISCOVERY_ENDPOINT_INVALID');
  }
  for (const k of ['userinfo_endpoint', 'end_session_endpoint']) if (doc[k] && new URL(doc[k]).origin !== origin) throw new OidcError('DISCOVERY_ENDPOINT_INVALID');
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

/** @param {any} cfg @param {{ state: string, nonce: string, verifier: string, redirectUri: string }} p @param {{ fetchImpl?: typeof fetch }} [opts] */
export async function authorizationUrl(cfg, p, opts = {}) {
  const doc = await discover(cfg.issuer, opts);
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: p.redirectUri, scope: cfg.scopes, state: p.state, nonce: p.nonce,
    acr_values: cfg.acr, code_challenge: pkceChallenge(p.verifier), code_challenge_method: 'S256', prompt: 'login' }).toString();
  return u.toString();
}

/** @param {string} jwt */
function decodeJwt(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new OidcError('JWT_MALFORMED');
  try {
    return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')), payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
  } catch { throw new OidcError('JWT_MALFORMED'); }
}

/** @param {string} jwksUri @param {{ fetchImpl?: typeof fetch, fresh?: boolean }} opts */
async function jwks(jwksUri, opts) {
  const hit = jwksCache.get(jwksUri);
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_MS) return hit.keys;
  const r = await fetchJson(opts.fetchImpl || fetch, jwksUri);
  let keys; try { keys = JSON.parse(r.text).keys; } catch { keys = null; }
  if (r.status !== 200 || !Array.isArray(keys)) throw new OidcError('JWKS_FAILED');
  jwksCache.set(jwksUri, { at: Date.now(), keys });
  return keys;
}

/**
 * Verify a JWS signed by the provider (alg from an allowlist; « none » and unknown algs refused).
 * @param {string} jwt @param {{ jwks_uri: string }} doc @param {string} clientSecret @param {{ fetchImpl?: typeof fetch }} opts
 */
export async function verifyJws(jwt, doc, clientSecret, opts = {}) {
  const d = decodeJwt(jwt);
  const alg = d.header?.alg;
  const data = Buffer.from(d.signingInput);
  if (alg === 'HS256') {
    const mac = crypto.createHmac('sha256', clientSecret).update(data).digest();
    if (mac.length !== d.signature.length || !crypto.timingSafeEqual(mac, d.signature)) throw new OidcError('JWT_SIGNATURE_INVALID');
    return d.payload;
  }
  if (alg !== 'RS256' && alg !== 'ES256') throw new OidcError('JWT_ALG_NOT_ALLOWED');
  const pick = async (/** @type {boolean} */ fresh) => (await jwks(doc.jwks_uri, { ...opts, fresh })).find((k) => (!d.header.kid || k.kid === d.header.kid) && (!k.use || k.use === 'sig')
    && (alg === 'RS256' ? k.kty === 'RSA' : k.kty === 'EC' && k.crv === 'P-256'));
  const jwk = (await pick(false)) || (await pick(true));   // key rotation: one refresh of the JWKS
  if (!jwk) throw new OidcError('JWT_KEY_UNKNOWN');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = alg === 'RS256' ? crypto.verify('sha256', data, key, d.signature) : crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, d.signature);
  if (!ok) throw new OidcError('JWT_SIGNATURE_INVALID');
  return d.payload;
}

/** @param {any} claims @param {{ issuer: string, clientId: string, nonce: string, now?: number }} p */
export function checkIdTokenClaims(claims, p) {
  const now = Math.floor((p.now ?? Date.now()) / 1000);
  if (String(claims?.iss || '').replace(/\/+$/, '') !== p.issuer) throw new OidcError('ID_TOKEN_ISSUER');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(p.clientId) || (aud.length > 1 && claims.azp !== p.clientId)) throw new OidcError('ID_TOKEN_AUDIENCE');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new OidcError('ID_TOKEN_EXPIRED');
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_S > now) throw new OidcError('ID_TOKEN_IAT');
  const a = Buffer.from(String(claims.nonce || '')); const b = Buffer.from(p.nonce);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new OidcError('ID_TOKEN_NONCE');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new OidcError('ID_TOKEN_SUB');
  return claims;
}

/**
 * Code → tokens → verified ID token (+ userinfo when the endpoint exists).
 * @param {any} cfg @param {{ code: string, verifier: string, nonce: string, redirectUri: string }} p @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ sub: string, issuer: string, idToken: string, acr: string | null, email: string | null }>}
 */
export async function completeAuthorization(cfg, p, opts = {}) {
  const doc = await discover(cfg.issuer, opts);
  const r = await fetchJson(opts.fetchImpl || fetch, doc.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: p.verifier }).toString(),
  });
  let tok; try { tok = JSON.parse(r.text); } catch { tok = null; }
  if (r.status !== 200 || !tok || typeof tok.id_token !== 'string' || typeof tok.access_token !== 'string') throw new OidcError('TOKEN_EXCHANGE_FAILED');
  const claims = checkIdTokenClaims(await verifyJws(tok.id_token, doc, cfg.clientSecret, opts), { issuer: cfg.issuer, clientId: cfg.clientId, nonce: p.nonce });
  let email = typeof claims.email === 'string' ? claims.email : null;
  if (doc.userinfo_endpoint) {
    const ui = await fetchJson(opts.fetchImpl || fetch, doc.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json, application/jwt' } });
    if (ui.status !== 200) throw new OidcError('USERINFO_FAILED');
    const info = ui.contentType.includes('application/jwt') ? await verifyJws(ui.text.trim(), doc, cfg.clientSecret, opts) : JSON.parse(ui.text);
    if (info?.sub !== claims.sub) throw new OidcError('USERINFO_SUB_MISMATCH');   // OIDC Core § 5.3.2
    if (typeof info.email === 'string') email = info.email;
  }
  return { sub: claims.sub, issuer: cfg.issuer, idToken: tok.id_token, acr: typeof claims.acr === 'string' ? claims.acr : null, email };
}

/** RP-initiated logout URL, or null when the provider has none @param {any} cfg @param {{ idToken: string, state: string, postLogoutRedirectUri: string }} p @param {{ fetchImpl?: typeof fetch }} [opts] */
export async function endSessionUrl(cfg, p, opts = {}) {
  const doc = await discover(cfg.issuer, opts);
  if (!doc.end_session_endpoint) return null;
  const u = new URL(doc.end_session_endpoint);
  u.search = new URLSearchParams({ id_token_hint: p.idToken, state: p.state, post_logout_redirect_uri: p.postLogoutRedirectUri }).toString();
  return u.toString();
}

/** test seam */
export function clearOidcCaches() { discoveryCache.clear(); jwksCache.clear(); }
