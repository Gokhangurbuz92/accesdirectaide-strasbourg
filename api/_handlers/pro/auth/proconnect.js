import logger from '../../../_utils/logger.js';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../../../src/db/index.js';
import { env } from '../../../_utils/env.js';
import { signProMfaPendingToken, logProAudit, signJwt, verifyJwt } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../../_utils/rateLimit.js';
import { normalizeNextPath } from '../../../../src/lib/rdvRouting.js';
import {
  proConnectConfig, proConnectStatus, discover, newAuthRequest, authorizationUrl, exchangeCode, verifyIdToken, fetchUserinfo, proConnectIdentity, endSessionUrl,
  ProConnectError,
} from '../../../lib/proconnect-oidc.js';

/**
 * R46 / N09 — ProConnect sign-in for EXISTING professional accounts (api/lib/proconnect-oidc.js holds the OIDC adapter).
 *
 *   GET  /api/pro/auth/proconnect/status    { provider, status: DISCONNECTED | CONFIGURED, available } — no value, no secret
 *   GET  /api/pro/auth/proconnect/start?next=/pro/…   302 to the federation (state + nonce + PKCE in a signed HttpOnly cookie, 10 min)
 *   GET  /api/pro/auth/proconnect/callback?code&state  302 back to /pro/login?proconnect=<outcome> (never a token in a URL)
 *   POST /api/pro/auth/proconnect/complete {structureId?}   the identified account(s) → { mfa_required, mfa_token } (then /api/pro/auth/mfa-verify as usual)
 *   GET  /api/pro/auth/proconnect/logout     302 to the federation logout (when configured), else to the sign-in page
 *
 * Rules: ProConnect only IDENTIFIES a person. ADA Pro access still needs an ACTIVE professional account created through an invitation, with the same e-mail
 * address, AND the ADA second factor (TOTP) — a ProConnect sign-in never creates an account, never activates one, never skips the second factor. While the
 * adapter is not configured every route answers « DISCONNECTED » and the sign-in page shows no ProConnect button. The capability gate (pro.account) applies.
 */
const BASE = '/api/pro/auth/proconnect';
const STATE_COOKIE = 'ada_pc_state';
const HANDOFF_COOKIE = 'ada_pc_handoff';
const IDT_COOKIE = 'ada_pc_idt';
const STATE_AUD = 'accesdirectaide-proconnect-state';
const HANDOFF_AUD = 'accesdirectaide-proconnect-handoff';
const ISS = 'accesdirectaide';
const STATE_TTL_S = 600;
const HANDOFF_TTL_S = 300;

const cookie = (/** @type {string} */ name, /** @type {string} */ value, /** @type {number} */ maxAge) => `${name}=${value}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const clear = (/** @type {string} */ name) => cookie(name, '', 0);
/** @param {unknown} header @param {string} name */
export function cookieOf(header, name) {
  for (const part of String(header || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
/** @param {any} res @param {string} location @param {string[]} [cookies] */
function redirect(res, location, cookies = []) {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', location);
  return res.status(302).end();
}
/** @param {string} outcome @param {string} next */
const loginPage = (outcome, next) => `/pro/login?proconnect=${encodeURIComponent(outcome)}&next=${encodeURIComponent(next)}`;
const secret = () => String(env.secrets.jwtSecret || "");
/** @param {any} req */
function subPath(req) {
  let p = '';
  try { p = new URL(String(req?.url || '/'), 'http://localhost').pathname; } catch { p = ''; }
  return p.replace(/\/+$/, '').split('/').pop() || '';
}

/**
 * @param {any} req @param {any} res
 * @param {{ db?: any, fetchImpl?: any, envVars?: Record<string, string | undefined>, now?: () => number }} [deps] test seams (a mock issuer)
 */
export async function proConnectHandler(req, res, deps = {}) {
  const envVars = deps.envVars || process.env;
  const db = deps.db || defaultDb;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const now = deps.now || Date.now;
  const action = subPath(req);
  const method = String(req.method || 'GET').toUpperCase();
  res.setHeader('Cache-Control', 'no-store');

  if (action === 'status') {
    if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return res.status(200).json(proConnectStatus(envVars));
  }

  const cfg = proConnectConfig(envVars);
  const ip = getClientIp(req);
  const url = new URL(String(req.url || '/'), 'http://localhost');
  const next = normalizeNextPath(url.searchParams.get('next'), '/pro/dashboard');
  const safeNext = next.startsWith('/pro/') ? next : '/pro/dashboard';

  if (action === 'logout') {
    if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const idt = cookieOf(req.headers?.cookie, IDT_COOKIE);
    let target = '/pro/login';
    if (cfg.configured && idt) {
      try { target = endSessionUrl(await discover(cfg, { fetchImpl, envVars, now: now() }), cfg, idt, crypto.randomBytes(16).toString('base64url')) || target; } catch { target = '/pro/login'; }
    }
    return redirect(res, target, [clear(IDT_COOKIE)]);
  }

  if (!cfg.configured) {
    if (action === 'start' || action === 'callback') return redirect(res, loginPage('disconnected', safeNext), [clear(STATE_COOKIE)]);
    return res.status(503).json({ error: 'PROCONNECT_DISCONNECTED', code: 'PROCONNECT_DISCONNECTED', message: 'La connexion avec ProConnect n’est pas activée pour Accès Direct Aide.' });
  }
  if (!secret()) return res.status(500).json({ error: 'Server configuration error' });

  const limit = await checkRateLimit('PROCONNECT_PRO', `ip:${ip}`);
  if (!limit.allowed) {
    if (method === 'GET') return redirect(res, loginPage('too_many', safeNext));
    return res.status(429).json(limit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
  }

  if (action === 'start') {
    if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const meta = await discover(cfg, { fetchImpl, envVars, now: now() });
      const ar = newAuthRequest();
      const state = signJwt({ s: ar.state, n: ar.nonce, v: ar.codeVerifier, next: safeNext }, secret(), { algorithm: 'HS256', expiresIn: STATE_TTL_S, issuer: ISS, audience: STATE_AUD });
      return redirect(res, authorizationUrl(meta, cfg, ar), [cookie(STATE_COOKIE, state, STATE_TTL_S)]);
    } catch (e) {
      logger.warn({ code: e instanceof ProConnectError ? e.code : 'ERROR' }, '[ProConnect] start failed');
      return redirect(res, loginPage('unavailable', safeNext));
    }
  }

  if (action === 'callback') {
    if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const raw = cookieOf(req.headers?.cookie, STATE_COOKIE);
    /** @type {any} */ let st = null;
    try { st = raw ? verifyJwt(raw, secret(), { algorithms: ['HS256'], issuer: ISS, audience: STATE_AUD }) : null; } catch { st = null; }
    const back = st?.next && String(st.next).startsWith('/pro/') ? String(st.next) : '/pro/dashboard';
    const cleared = [clear(STATE_COOKIE)];
    const stateParam = String(url.searchParams.get('state') || '');
    if (!st || !stateParam || stateParam.length !== String(st.s).length || !crypto.timingSafeEqual(Buffer.from(stateParam), Buffer.from(String(st.s)))) {
      await logProAudit('PROCONNECT_FAILED', 'unknown', null, { reason: 'STATE_INVALID' }, ip);
      return redirect(res, loginPage('failed', back), cleared);
    }
    if (url.searchParams.get('error')) {
      // the person cancelled at the federation, or it refused: its error text is never echoed
      return redirect(res, loginPage(url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed', back), cleared);
    }
    try {
      const meta = await discover(cfg, { fetchImpl, envVars, now: now() });
      const tok = await exchangeCode(meta, cfg, String(url.searchParams.get('code') || ''), st.v, { fetchImpl });
      const claims = await verifyIdToken(tok.idToken, meta, cfg, { nonce: st.n, fetchImpl, now: now() });
      const info = await fetchUserinfo(meta, cfg, tok.accessToken, claims.sub, { fetchImpl, now: now() });
      const who = proConnectIdentity(claims, info);
      const rows = (await db.execute(sql`SELECT id, "structureId", status, mfa_enabled AS "mfaEnabled" FROM "ProUser" WHERE lower(email) = ${who.email} ORDER BY "createdAt" LIMIT 10`)).rows;
      const active = rows.filter((/** @type {any} */ u) => u.status === 'active');
      const idtCookie = tok.idToken.length < 3500 ? [cookie(IDT_COOKIE, tok.idToken, 12 * 3600)] : [];
      if (!active.length) {
        // never an account creation: only an administrator's invitation creates a professional account
        await logProAudit('PROCONNECT_NO_ACCOUNT', 'unknown', null, { reason: rows.length ? 'ACCOUNT_NOT_ACTIVE' : 'NO_INVITED_ACCOUNT' }, ip);
        return redirect(res, loginPage('no_account', back), [...cleared, ...idtCookie]);
      }
      const ready = active.filter((/** @type {any} */ u) => u.mfaEnabled === true);
      if (!ready.length) {
        await logProAudit('PROCONNECT_MFA_ENROLMENT_REQUIRED', active[0].id, active[0].structureId, {}, ip);
        return redirect(res, loginPage('mfa_enrolment_required', back), [...cleared, ...idtCookie]);
      }
      const handoff = signJwt({ u: ready.map((/** @type {any} */ u) => u.id), sub: crypto.createHash('sha256').update(`proconnect:${who.sub}`).digest('hex').slice(0, 32) },
        secret(), { algorithm: 'HS256', expiresIn: HANDOFF_TTL_S, issuer: ISS, audience: HANDOFF_AUD, jwtid: crypto.randomUUID() });
      await logProAudit('PROCONNECT_IDENTIFIED', ready[0].id, ready[0].structureId, { accounts: ready.length, siret: who.siret ? 'present' : 'absent' }, ip);
      return redirect(res, loginPage('continue', back), [...cleared, cookie(HANDOFF_COOKIE, handoff, HANDOFF_TTL_S), ...idtCookie]);
    } catch (e) {
      const code = e instanceof ProConnectError ? e.code : 'ERROR';
      logger.warn({ code }, '[ProConnect] callback refused');   // never a token, a code or a provider answer
      await logProAudit('PROCONNECT_FAILED', 'unknown', null, { reason: code }, ip);
      return redirect(res, loginPage(code === 'PROVIDER_UNREACHABLE' || code === 'PROVIDER_UNAVAILABLE' ? 'unavailable' : 'failed', back), cleared);
    }
  }

  if (action === 'complete') {
    if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const raw = cookieOf(req.headers?.cookie, HANDOFF_COOKIE);
    /** @type {any} */ let h = null;
    try { h = raw ? verifyJwt(raw, secret(), { algorithms: ['HS256'], issuer: ISS, audience: HANDOFF_AUD }) : null; } catch { h = null; }
    if (!h || !Array.isArray(h.u) || !h.u.length) return res.status(401).json({ error: 'PROCONNECT_HANDOFF_INVALID', code: 'PROCONNECT_HANDOFF_INVALID' });
    const ids = h.u.map(String).slice(0, 10);
    const users = (await db.execute(sql`SELECT u.id, u.email, u."structureId", u.status, u.mfa_enabled AS "mfaEnabled", u.mfa_secret IS NOT NULL AS "hasSecret", s.nom AS name
      FROM "ProUser" u LEFT JOIN "Structure" s ON s.id = u."structureId" WHERE u.id IN (${sql.join(ids.map((/** @type {string} */ i) => sql`${i}`), sql`, `)})`)).rows
      .filter((/** @type {any} */ u) => u.status === 'active' && u.mfaEnabled === true && u.hasSecret === true);
    if (!users.length) { res.setHeader('Set-Cookie', clear(HANDOFF_COOKIE)); return res.status(403).json({ error: 'PROCONNECT_NO_ACCOUNT', code: 'PROCONNECT_NO_ACCOUNT' }); }
    const wanted = String(req.body?.structureId || '');
    const target = users.length === 1 ? users[0] : users.find((/** @type {any} */ u) => u.structureId === wanted);
    if (!target) {
      // the handoff stays (5 min) so the person can choose; it opens nothing by itself
      return res.status(409).json({ code: 'ORGANIZATION_CHOICE_REQUIRED', message: 'Votre adresse ouvre un compte dans plusieurs organisations : choisissez celle à laquelle vous connecter.',
        organizations: users.map((/** @type {any} */ u) => ({ structureId: u.structureId, name: u.name || 'Organisation' })) });
    }
    res.setHeader('Set-Cookie', clear(HANDOFF_COOKIE));   // single use
    await logProAudit('MFA_CHALLENGE', target.id, target.structureId, { via: 'proconnect' }, ip);
    // the ADA second factor is still required: the same short-lived pending token as after a password
    return res.status(200).json({ mfa_required: true, mfa_token: signProMfaPendingToken({ id: target.id, email: target.email, structureId: target.structureId }), via: 'proconnect' });
  }

  return res.status(404).json({ error: 'Not found' });
}

export default async function handler(/** @type {any} */ req, /** @type {any} */ res) {
  return proConnectHandler(req, res);
}
