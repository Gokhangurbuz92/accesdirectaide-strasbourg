// @ts-nocheck
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
import { db } from '../../../src/db/index.js';
import { CitizenUser } from '../../../src/db/schema.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { capabilityState } from '../../_utils/capabilities.js';
import { isSecureEnvironment } from '../../_utils/security.js';
import { resolveCitizen } from '../../_utils/citizen-auth.js';
import { buildAppUrl, buildUserSessionCookie, buildUserSessionCookieClear, normalizeNextPath, parseCookies, signUserSessionToken } from '../../_utils/user-auth.js';
import { authorizationUrl, completeAuthorization, endSessionUrl, franceConnectConfig, randomToken } from '../../lib/franceconnect/oidc-client.js';
import { findLinkedAccount, linkAccount, linkStatus, touchLink, unlinkAccount } from '../../_services/franceconnect-link.js';

/**
 * R46 / N08 (C26) — FranceConnect sign-in and account link (OIDC adapter: api/lib/franceconnect/oidc-client.js). NOT LIVE: no FranceConnect credentials exist;
 * the LAB runs it against scripts/lab/mock-franceconnect.mjs.
 *   GET  /api/auth/franceconnect/status          { available, reason, linked? } — the provider-status line of the UI (never a value)
 *   GET  /api/auth/franceconnect/login?next=…     302 to the provider (state, nonce, PKCE S256 in a signed HttpOnly flow cookie, 10 minutes, one use)
 *   GET  /api/auth/franceconnect/link             same, to LINK the signed-in account (session required)
 *   GET  /api/auth/franceconnect/callback         code → verified ID token → sign-in of the LINKED account only / link; 302 back to the app
 *   POST /api/auth/franceconnect/unlink           remove the link (session; CSRF double-submit like every mutation)
 *   POST /api/auth/franceconnect/logout           end the ADA session (server-side revocation) + { endSessionUrl } of the provider when it has one
 * No account is ever created from FranceConnect and no account is linked by e-mail match. Errors return the person to /auth/login?fc=<code>.
 */
const FLOW_COOKIE = 'ada_fc_flow';
const IDT_COOKIE = 'ada_fc_idt';
const FLOW_TTL_MS = 10 * 60 * 1000;

const flowKey = () => crypto.createHmac('sha256', String(env.auth.secret || env.secrets.jwtSecret || '')).update('ada-franceconnect-flow-v1').digest();
const seal = (obj) => { const body = Buffer.from(JSON.stringify(obj)).toString('base64url'); return `${body}.${crypto.createHmac('sha256', flowKey()).update(body).digest('base64url')}`; };
function unseal(value) {
  const [body, mac] = String(value || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', flowKey()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return o && o.e > Date.now() ? o : null; } catch { return null; }
}
// SameSite=Lax: the callback is a top-level navigation coming back from the provider's site (a Strict cookie would not be sent)
const cookie = (name, value, maxAgeS) => `${name}=${value}; Path=/api/auth/franceconnect; HttpOnly; SameSite=Lax${isSecureEnvironment() ? '; Secure' : ''}; Max-Age=${maxAgeS}`;

/** availability for this environment: the capability AND the adapter configuration */
export function franceConnectAvailability(envVars = process.env) {
  const cap = capabilityState('citizen.franceconnect', envVars);
  if (!cap.open) return { available: false, reason: `CAPABILITY_${cap.reason}` };
  const cfg = franceConnectConfig(envVars);
  return cfg.ok ? { available: true, reason: null, cfg } : { available: false, reason: cfg.reason };
}

const back = (res, code, cookies = []) => {
  res.setHeader('Set-Cookie', [cookie(FLOW_COOKIE, '', 0), ...cookies]);
  res.setHeader('Location', `/auth/login?fc=${encodeURIComponent(code)}`);
  return res.status(302).end();
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(String(req.url || '/'), 'http://localhost');
  const action = url.pathname.replace(/^\/api/, '').replace(/^\/auth\/franceconnect\/?/, '').replace(/\/+$/, '');
  const ip = getClientIp(req);
  // the callback is the credential step (counted like a password sign-in); the status line and the redirects are reads; unlink / logout are account writes
  const bucket = action === 'callback' ? 'LOGIN_USER' : req.method === 'GET' ? 'CITIZEN_ACCOUNT_READ' : 'CITIZEN_ACCOUNT_WRITE';
  const limit = await checkRateLimit(bucket, `fc:${ip}`);
  if (!limit.allowed) return res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many attempts' });
  const avail = franceConnectAvailability();

  if (action === 'status' && req.method === 'GET') {
    const citizen = await resolveCitizen(req).catch(() => null);
    return res.status(200).json({ available: avail.available, reason: avail.reason, provider: 'franceconnect', live: false,
      ...(citizen ? { linked: (await linkStatus(citizen.id)).linked } : {}) });
  }

  if ((action === 'login' || action === 'link') && req.method === 'GET') {
    if (!avail.available) return back(res, 'unavailable');
    let userId = null;
    if (action === 'link') {
      const citizen = await resolveCitizen(req).catch(() => null);
      if (!citizen) return back(res, 'session_required');
      userId = citizen.id;
    }
    const flow = { s: randomToken(), n: randomToken(), v: randomToken(), i: action, u: userId,
      x: normalizeNextPath(url.searchParams.get('next') || req.query?.next, action === 'link' ? '/compte/profil' : '/compte'), e: Date.now() + FLOW_TTL_MS };
    try {
      const redirectUri = avail.cfg.redirectUri || buildAppUrl('/api/auth/franceconnect/callback');
      const location = await authorizationUrl(avail.cfg, { state: flow.s, nonce: flow.n, verifier: flow.v, redirectUri });
      res.setHeader('Set-Cookie', cookie(FLOW_COOKIE, seal(flow), Math.floor(FLOW_TTL_MS / 1000)));
      res.setHeader('Location', location);
      return res.status(302).end();
    } catch (error) {
      logger.warn(`[franceconnect] authorize failed: ${error?.code || error?.name}`);
      return back(res, 'provider_unavailable');
    }
  }

  if (action === 'callback' && req.method === 'GET') {
    const flow = unseal(parseCookies(req)[FLOW_COOKIE]);
    const state = String(url.searchParams.get('state') || req.query?.state || '');
    if (!flow || !state || Buffer.byteLength(state) !== Buffer.byteLength(flow.s) || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(flow.s))) return back(res, 'state_invalid');
    if (url.searchParams.get('error') || req.query?.error) return back(res, 'cancelled');
    if (!avail.available) return back(res, 'unavailable');
    const code = String(url.searchParams.get('code') || req.query?.code || '');
    if (!code || code.length > 2048) return back(res, 'code_missing');
    let identity;
    try {
      const redirectUri = avail.cfg.redirectUri || buildAppUrl('/api/auth/franceconnect/callback');
      identity = await completeAuthorization(avail.cfg, { code, verifier: flow.v, nonce: flow.n, redirectUri });
    } catch (error) {
      logger.warn(`[franceconnect] callback refused: ${error?.code || error?.name}`);
      return back(res, 'verification_failed');
    }
    const idtCookie = cookie(IDT_COOKIE, encodeURIComponent(identity.idToken), 12 * 3600);
    if (flow.i === 'link') {
      const citizen = await resolveCitizen(req).catch(() => null);
      if (!citizen || citizen.id !== flow.u) return back(res, 'session_required');
      const out = await linkAccount(citizen.id, identity.issuer, identity.sub);
      if (!out.ok) return back(res, 'linked_elsewhere');
      res.setHeader('Set-Cookie', [cookie(FLOW_COOKIE, '', 0), idtCookie]);
      res.setHeader('Location', `${flow.x}${flow.x.includes('?') ? '&' : '?'}fc=linked`);
      return res.status(302).end();
    }
    const account = await findLinkedAccount(identity.issuer, identity.sub);
    // no link = no sign-in (no account creation, no e-mail matching); the same answer whether or not an account exists for the FranceConnect e-mail
    if (!account || !account.emailVerifiedAt) return back(res, 'not_linked');
    if (account.lockoutUntil && new Date(account.lockoutUntil).getTime() > Date.now()) return back(res, 'not_linked');
    await touchLink(identity.issuer, identity.sub);
    await db.update(CitizenUser).set({ lastSeenAt: new Date() }).where(eq(CitizenUser.id, account.id)).catch(() => {});
    const session = signUserSessionToken({ userId: account.id, email: account.email });
    // « ada_fc=1 »: a readable marker (no secret) so the interface also ends the provider's session at sign-out (src/lib/citizenSession.js)
    res.setHeader('Set-Cookie', [cookie(FLOW_COOKIE, '', 0), idtCookie, buildUserSessionCookie(session), `ada_fc=1; Path=/; SameSite=Lax${isSecureEnvironment() ? '; Secure' : ''}; Max-Age=${12 * 3600}`]);
    res.setHeader('Location', flow.x);
    return res.status(302).end();
  }

  if (action === 'unlink' && req.method === 'POST') {
    const citizen = await resolveCitizen(req).catch(() => null);
    if (!citizen) return res.status(401).json({ error: 'Unauthorized' });
    const { ok: _ok, status, ...body } = await unlinkAccount(citizen.id);
    return res.status(status).json(body);
  }

  if (action === 'logout' && req.method === 'POST') {
    const citizen = await resolveCitizen(req).catch(() => null);
    let revoked = true;
    if (citizen) revoked = await db.update(CitizenUser).set({ sessionsValidAfter: new Date() }).where(eq(CitizenUser.id, citizen.id)).then(() => true, () => false);
    const idToken = decodeURIComponent(String(parseCookies(req)[IDT_COOKIE] || ''));
    let endSession = null;
    if (idToken && avail.available) {
      endSession = await endSessionUrl(avail.cfg, { idToken, state: randomToken(), postLogoutRedirectUri: avail.cfg.postLogoutRedirectUri || buildAppUrl('/') }).catch(() => null);
    }
    res.setHeader('Set-Cookie', [buildUserSessionCookieClear(), cookie(IDT_COOKIE, '', 0), 'ada_fc=; Path=/; SameSite=Lax; Max-Age=0']);
    if (!revoked) return res.status(503).json({ ok: false, error: 'LOGOUT_NOT_CONFIRMED' });
    return res.status(200).json({ ok: true, endSessionUrl: endSession });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
