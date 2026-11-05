/**
 * R46 / N09 — ProConnect (OpenID Connect) relying-party adapter, software side only.
 *
 * ProConnect is the State's identity federation for public-sector and partner professionals. This module implements a standard OIDC authorization-code
 * flow (RFC 6749 + OpenID Connect Core 1.0, PKCE S256 RFC 7636) against an issuer the OWNER configures; nothing here names or calls a provider by itself.
 * The adapter is DISCONNECTED until every variable below is set (env names only, never a value in the repository):
 *   PROCONNECT_ENABLED=true                     owner switch
 *   PROCONNECT_ISSUER                           the issuer given by the federation at registration (https; http only on 127.0.0.1 / localhost outside production)
 *   PROCONNECT_CLIENT_ID / PROCONNECT_CLIENT_SECRET   the client registered for ADA Pro (secret: client_secret_post)
 *   PROCONNECT_REDIRECT_URI                     the registered callback (…/api/pro/auth/proconnect/callback)
 *   PROCONNECT_POST_LOGOUT_REDIRECT_URI         the registered post-logout page (optional: without it the federation logout is not offered)
 *   PROCONNECT_SCOPES (optional, default « openid email given_name usual_name siret »), PROCONNECT_ACR_VALUES (optional)
 *
 * Security properties (tests: tests/unit/r46-proconnect-oidc.test.js against a local mock issuer):
 *   - discovery metadata must name exactly the configured issuer; every endpoint must be https (local http only in the LAB);
 *   - state + nonce + PKCE verifier are random (32 bytes), carried in a signed, short-lived (10 min), HttpOnly cookie bound to this browser;
 *   - the ID token must be RS256 or ES256 (never « none », never HS*), signed by a key of the issuer's JWKS (kid lookup, one refetch on an unknown kid),
 *     with the configured issuer, our client in `aud` (and `azp` when several audiences), unexpired, issued not in the future (120 s skew), and our nonce;
 *   - the userinfo answer (JSON or signed JWT) must carry the same `sub`; a signed userinfo is verified like the ID token (without nonce);
 *   - GET requests (discovery, JWKS) time out (8 s) and are retried once on a network error or a 5xx; the code exchange is never retried (single-use code).
 * ProConnect only identifies the person: access to ADA Pro still needs an ACTIVE, invitation-created professional account with the same verified e-mail AND
 * the ADA second factor (api/_handlers/pro/auth/proconnect.js). Nobody gets a professional account by signing in with ProConnect.
 */
import crypto from 'node:crypto';

export const PROCONNECT_REQUIRED_ENV = Object.freeze(['PROCONNECT_ENABLED', 'PROCONNECT_ISSUER', 'PROCONNECT_CLIENT_ID', 'PROCONNECT_CLIENT_SECRET', 'PROCONNECT_REDIRECT_URI']);
export const PROCONNECT_OPTIONAL_ENV = Object.freeze(['PROCONNECT_POST_LOGOUT_REDIRECT_URI', 'PROCONNECT_SCOPES', 'PROCONNECT_ACR_VALUES']);
export const DEFAULT_SCOPES = 'openid email given_name usual_name siret';
const ALLOWED_ALGS = new Set(['RS256', 'ES256']);
const CLOCK_SKEW_S = 120;
const HTTP_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export class ProConnectError extends Error {
  /** @param {string} code stable machine code (never contains a token or a personal value) @param {string} [detail] */
  constructor(code, detail = '') { super(detail ? `${code}: ${detail}` : code); this.name = 'ProConnectError'; this.code = code; }
}

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();
const isProduction = (/** @type {Record<string, string | undefined>} */ envVars) => ['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase());
/** an endpoint ADA may call: https, or http on a loopback host outside production/preview (the LAB mock issuer) */
export function allowedEndpoint(/** @type {unknown} */ value, envVars = process.env) {
  let u; try { u = new URL(String(value)); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !isProduction(envVars);
}

/**
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {{ configured: boolean, missing: string[], invalid: string[], issuer: string, clientId: string, clientSecret: string, redirectUri: string,
 *   postLogoutRedirectUri: string, scopes: string, acrValues: string }}
 */
export function proConnectConfig(envVars = process.env) {
  const missing = PROCONNECT_REQUIRED_ENV.filter((k) => !flag(envVars[k]));
  const invalid = [];
  if (flag(envVars.PROCONNECT_ENABLED) && flag(envVars.PROCONNECT_ENABLED) !== 'true') invalid.push('PROCONNECT_ENABLED');
  for (const k of ['PROCONNECT_ISSUER', 'PROCONNECT_REDIRECT_URI', 'PROCONNECT_POST_LOGOUT_REDIRECT_URI']) if (flag(envVars[k]) && !allowedEndpoint(flag(envVars[k]), envVars)) invalid.push(k);
  const scopes = flag(envVars.PROCONNECT_SCOPES) || DEFAULT_SCOPES;
  if (!scopes.split(/\s+/).includes('openid') || !scopes.split(/\s+/).includes('email')) invalid.push('PROCONNECT_SCOPES');
  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing, invalid,
    issuer: flag(envVars.PROCONNECT_ISSUER).replace(/\/+$/, ''),
    clientId: flag(envVars.PROCONNECT_CLIENT_ID), clientSecret: flag(envVars.PROCONNECT_CLIENT_SECRET),
    redirectUri: flag(envVars.PROCONNECT_REDIRECT_URI), postLogoutRedirectUri: flag(envVars.PROCONNECT_POST_LOGOUT_REDIRECT_URI),
    scopes, acrValues: flag(envVars.PROCONNECT_ACR_VALUES),
  };
}

/** the provider-status line (no value, no secret): DISCONNECTED until the owner configures it @param {Record<string, string | undefined>} [envVars] */
export function proConnectStatus(envVars = process.env) {
  const c = proConnectConfig(envVars);
  if (c.configured) return { provider: 'proconnect', status: 'CONFIGURED', available: true, missing: [], invalid: [] };
  return { provider: 'proconnect', status: 'DISCONNECTED', available: false, missing: c.missing, invalid: c.invalid };
}

/** @param {any} fetchImpl @param {string} url @param {RequestInit} init @param {{ retry?: boolean }} [o] */
async function httpJson(fetchImpl, url, init = {}, { retry = true } = {}) {
  let last;
  for (let attempt = 0; attempt < (retry ? 2 : 1); attempt += 1) {
    try {
      const r = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (r.status >= 500 && retry && attempt === 0) { last = new ProConnectError('PROVIDER_UNAVAILABLE', String(r.status)); continue; }
      return r;
    } catch (e) {
      last = new ProConnectError('PROVIDER_UNREACHABLE', e instanceof Error ? e.name : 'Error');
    }
  }
  throw last || new ProConnectError('PROVIDER_UNREACHABLE');
}

const discoveryCache = new Map();
const jwksCache = new Map();
/** test hook */
export function _resetProConnectCaches() { discoveryCache.clear(); jwksCache.clear(); }

/**
 * OpenID Provider metadata of the configured issuer (cached 1 h), validated.
 * @param {ReturnType<typeof proConnectConfig>} cfg @param {{ fetchImpl?: any, envVars?: Record<string, string | undefined>, now?: number }} [o]
 */
export async function discover(cfg, { fetchImpl = globalThis.fetch, envVars = process.env, now = Date.now() } = {}) {
  const hit = discoveryCache.get(cfg.issuer);
  if (hit && hit.until > now) return hit.meta;
  const r = await httpJson(fetchImpl, `${cfg.issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new ProConnectError('DISCOVERY_FAILED', String(r.status));
  /** @type {any} */ let meta; try { meta = await r.json(); } catch { throw new ProConnectError('DISCOVERY_FAILED', 'not json'); }
  if (!meta || String(meta.issuer).replace(/\/+$/, '') !== cfg.issuer) throw new ProConnectError('ISSUER_MISMATCH');
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!allowedEndpoint(meta[k], envVars)) throw new ProConnectError('DISCOVERY_INVALID', k);
  for (const k of ['userinfo_endpoint', 'end_session_endpoint']) if (meta[k] !== undefined && !allowedEndpoint(meta[k], envVars)) throw new ProConnectError('DISCOVERY_INVALID', k);
  if (Array.isArray(meta.code_challenge_methods_supported) && !meta.code_challenge_methods_supported.includes('S256')) throw new ProConnectError('PKCE_UNSUPPORTED');
  discoveryCache.set(cfg.issuer, { meta, until: now + CACHE_TTL_MS });
  return meta;
}

const b64u = (/** @type {Buffer} */ b) => b.toString('base64url');
/** a fresh authorization request: state, nonce, PKCE verifier and S256 challenge */
export function newAuthRequest() {
  const codeVerifier = b64u(crypto.randomBytes(32));
  return { state: b64u(crypto.randomBytes(32)), nonce: b64u(crypto.randomBytes(32)), codeVerifier, codeChallenge: b64u(crypto.createHash('sha256').update(codeVerifier).digest()) };
}

/** @param {any} meta @param {ReturnType<typeof proConnectConfig>} cfg @param {{ state: string, nonce: string, codeChallenge: string }} ar */
export function authorizationUrl(meta, cfg, ar) {
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', cfg.scopes);
  u.searchParams.set('state', ar.state);
  u.searchParams.set('nonce', ar.nonce);
  u.searchParams.set('code_challenge', ar.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (cfg.acrValues) u.searchParams.set('acr_values', cfg.acrValues);
  return u.toString();
}

/** authorization code → tokens (client_secret_post; never retried: a code is single-use) @param {any} meta @param {ReturnType<typeof proConnectConfig>} cfg @param {string} code @param {string} codeVerifier @param {{ fetchImpl?: any }} [o] */
export async function exchangeCode(meta, cfg, code, codeVerifier, { fetchImpl = globalThis.fetch } = {}) {
  if (!code || typeof code !== 'string' || code.length > 2048) throw new ProConnectError('CODE_INVALID');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: codeVerifier });
  const r = await httpJson(fetchImpl, meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() }, { retry: false });
  if (!r.ok) throw new ProConnectError('TOKEN_EXCHANGE_FAILED', String(r.status));   // the answer body is never read into a log
  /** @type {any} */ let tok; try { tok = await r.json(); } catch { throw new ProConnectError('TOKEN_EXCHANGE_FAILED', 'not json'); }
  if (!tok || typeof tok.id_token !== 'string' || typeof tok.access_token !== 'string') throw new ProConnectError('TOKEN_EXCHANGE_FAILED', 'missing tokens');
  if (tok.token_type && String(tok.token_type).toLowerCase() !== 'bearer') throw new ProConnectError('TOKEN_EXCHANGE_FAILED', 'token_type');
  return { idToken: tok.id_token, accessToken: tok.access_token };
}

/** @param {any} meta @param {{ fetchImpl?: any, now?: number, force?: boolean }} o */
async function jwks(meta, { fetchImpl = globalThis.fetch, now = Date.now(), force = false } = {}) {
  const hit = jwksCache.get(meta.jwks_uri);
  if (hit && hit.until > now && !(force && hit.fetchedAt + 60000 < now)) return hit.keys;
  const r = await httpJson(fetchImpl, meta.jwks_uri, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new ProConnectError('JWKS_FAILED', String(r.status));
  /** @type {any} */ let j; try { j = await r.json(); } catch { throw new ProConnectError('JWKS_FAILED', 'not json'); }
  const keys = Array.isArray(j?.keys) ? j.keys : [];
  jwksCache.set(meta.jwks_uri, { keys, until: now + CACHE_TTL_MS, fetchedAt: now });
  return keys;
}

/** split and decode a compact JWS (no verification) @param {string} jws */
function decodeJws(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[2]) throw new ProConnectError('JWT_MALFORMED');
  let header, payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new ProConnectError('JWT_MALFORMED'); }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') throw new ProConnectError('JWT_MALFORMED');
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
}

/** verify the signature of a compact JWS with the issuer's JWKS; returns its payload @param {string} jws @param {any} meta @param {{ fetchImpl?: any, now?: number }} [o] */
async function verifySignature(jws, meta, o = {}) {
  const { header, payload, signingInput, signature } = decodeJws(jws);
  if (!ALLOWED_ALGS.has(header.alg)) throw new ProConnectError('JWT_ALG_REFUSED', String(header.alg));
  const pick = (/** @type {any[]} */ keys) => keys.filter((k) => k && (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg)
    && (header.alg === 'RS256' ? k.kty === 'RSA' : k.kty === 'EC' && k.crv === 'P-256'));
  let candidates = pick(await jwks(meta, o));
  if (!candidates.length) candidates = pick(await jwks(meta, { ...o, force: true }));   // key rotation: one refetch
  if (!candidates.length) throw new ProConnectError('JWT_KEY_UNKNOWN');
  for (const jwk of candidates) {
    let key; try { key = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { continue; }
    const ok = header.alg === 'RS256'
      ? crypto.verify('sha256', Buffer.from(signingInput), key, signature)
      : crypto.verify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature);
    if (ok) return payload;
  }
  throw new ProConnectError('JWT_SIGNATURE_INVALID');
}

/** @param {any} claims @param {ReturnType<typeof proConnectConfig>} cfg */
function checkStandardClaims(claims, cfg) {
  if (String(claims.iss || '').replace(/\/+$/, '') !== cfg.issuer) throw new ProConnectError('JWT_ISSUER_INVALID');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new ProConnectError('JWT_AUDIENCE_INVALID');
  if (aud.length > 1 && claims.azp !== cfg.clientId) throw new ProConnectError('JWT_AUDIENCE_INVALID', 'azp');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new ProConnectError('JWT_SUBJECT_MISSING');
}

/**
 * @param {string} idToken @param {any} meta @param {ReturnType<typeof proConnectConfig>} cfg
 * @param {{ nonce: string, fetchImpl?: any, now?: number }} o
 */
export async function verifyIdToken(idToken, meta, cfg, { nonce, fetchImpl = globalThis.fetch, now = Date.now() }) {
  const claims = await verifySignature(idToken, meta, { fetchImpl, now });
  const nowS = Math.floor(now / 1000);
  checkStandardClaims(claims, cfg);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) throw new ProConnectError('JWT_EXPIRED');
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_S > nowS) throw new ProConnectError('JWT_IAT_INVALID');
  if (!nonce || typeof claims.nonce !== 'string' || claims.nonce.length !== nonce.length || !crypto.timingSafeEqual(Buffer.from(claims.nonce), Buffer.from(nonce))) throw new ProConnectError('JWT_NONCE_INVALID');
  return claims;
}

/**
 * userinfo (JSON, or a signed JWT as ProConnect returns it); its `sub` must be the ID token's.
 * @param {any} meta @param {ReturnType<typeof proConnectConfig>} cfg @param {string} accessToken @param {string} sub @param {{ fetchImpl?: any, now?: number }} [o]
 */
export async function fetchUserinfo(meta, cfg, accessToken, sub, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!meta.userinfo_endpoint) throw new ProConnectError('USERINFO_UNAVAILABLE');
  const r = await httpJson(fetchImpl, meta.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/jwt, application/json' } }, { retry: false });
  if (!r.ok) throw new ProConnectError('USERINFO_FAILED', String(r.status));
  const type = String(r.headers.get('content-type') || '').toLowerCase();
  /** @type {any} */ let info;
  if (type.includes('application/jwt')) {
    info = await verifySignature((await r.text()).trim(), meta, { fetchImpl, now });
    checkStandardClaims(info, cfg);
  } else {
    try { info = await r.json(); } catch { throw new ProConnectError('USERINFO_FAILED', 'not json'); }
  }
  if (!info || info.sub !== sub) throw new ProConnectError('USERINFO_SUBJECT_MISMATCH');
  return info;
}

/** the identity ADA keeps from ProConnect (minimal): subject, verified-by-the-federation e-mail (lower-cased), organisation SIRET if given @param {any} claims @param {any} info */
export function proConnectIdentity(claims, info) {
  const email = String(info.email || claims.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ProConnectError('EMAIL_MISSING');
  const siret = /^\d{14}$/.test(String(info.siret || '')) ? String(info.siret) : null;
  return { sub: String(claims.sub), email, siret, acr: typeof claims.acr === 'string' ? claims.acr : null };
}

/** the federation logout URL (RP-initiated logout), or null when not configured @param {any} meta @param {ReturnType<typeof proConnectConfig>} cfg @param {string} idTokenHint @param {string} state */
export function endSessionUrl(meta, cfg, idTokenHint, state) {
  if (!meta.end_session_endpoint || !cfg.postLogoutRedirectUri || !idTokenHint) return null;
  const u = new URL(meta.end_session_endpoint);
  u.searchParams.set('id_token_hint', idTokenHint);
  u.searchParams.set('state', state);
  u.searchParams.set('post_logout_redirect_uri', cfg.postLogoutRedirectUri);
  return u.toString();
}
