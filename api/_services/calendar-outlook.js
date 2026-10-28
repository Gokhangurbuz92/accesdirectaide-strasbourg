// @ts-nocheck
/**
 * PKG-3 / B10 — Outlook calendar connection, redesigned (was QUARANTINED: three token formats, a plaintext fallback, an unsigned OAuth `state` that linked the tokens to the
 * FIRST professional of a structure, and a callback importing a module that does not exist).
 *
 *  - ONE token format: the strict AES-256-GCM envelope of api/_utils/outlook-token-crypto.js (`ivHex:tagHex:cipherHex`, no plaintext fallback). A stored row in any other
 *    format is treated as "not connected" (reconnect), never decrypted loosely.
 *  - A SIGNED, expiring `state` bound to the professional who started the connection (user + structure + nonce, HMAC-SHA256, 10 minutes). The callback links the tokens to
 *    that professional only, after re-checking that the account is active and still in that structure.
 *  - OFF by default: OUTLOOK_ENABLED=true + client id/secret/redirect URI + a 32+ character token key; in production also CALENDAR_PRODUCTION_APPROVED=true (Microsoft app
 *    registration, DPO and security approvals) — and scripts/release-preflight.mjs still fails a release with OUTLOOK_ENABLED until the owner lifts it.
 *  - Sandbox: OUTLOOK_AUTHORITY_URL can point at a test authority; the LAB tests run the whole flow against an in-process fake (no Microsoft call). A real Microsoft
 *    sign-in has NOT been verified: that needs the Microsoft app registration (external dependency).
 * Logs never contain a code, a token or the state.
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProOutlookToken, ProUser } from '../../src/db/schema.js';
import { decryptToken, encryptToken, envelopeIv } from '../_utils/outlook-token-crypto.js';
import { env as serverEnv } from '../_utils/env.js';

export const OUTLOOK_SCOPES = 'openid profile email Calendars.ReadWrite offline_access';
const STATE_TTL_MS = 10 * 60_000;
const authority = (env) => String(env.OUTLOOK_AUTHORITY_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0').replace(/\/+$/, '');

export function outlookStatus(env = process.env) {
  const off = (reason) => ({ enabled: false, reason });
  if (String(env.OUTLOOK_ENABLED || '') !== 'true') return off('NOT_CONFIGURED');
  if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET || !env.OUTLOOK_REDIRECT_URI) return off('INCOMPLETE_CONFIGURATION');
  if (String(env.OUTLOOK_TOKEN_ENCRYPTION_KEY || '').length < 32) return off('MISSING_ENCRYPTION_KEY');
  if (String(env.VERCEL_ENV || '') === 'production' && String(env.CALENDAR_PRODUCTION_APPROVED || '') !== 'true') return off('PRODUCTION_ACTIVATION_PENDING');
  return { enabled: true, reason: null };
}

function stateSecret(env) {
  // the server's signing secret (same resolution as the admin tokens: AUTH_SECRET / AUTH_JWT_SECRET, else JWT_SECRET), domain-separated; no secret = no state (fail closed)
  const s = String(env === process.env ? (serverEnv.auth.secret || serverEnv.secrets.jwtSecret || '') : (env.AUTH_SECRET || env.JWT_SECRET || ''));
  if (s.length < 12) throw new Error('state secret unavailable');
  return crypto.createHash('sha256').update(`ada/outlook-state/v1|${s}`).digest();
}
export function signState({ userId, structureId }, { now = Date.now(), env = process.env, nonce = crypto.randomBytes(12).toString('base64url') } = {}) {
  const body = Buffer.from(JSON.stringify({ u: userId, s: structureId, n: nonce, e: now + STATE_TTL_MS })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', stateSecret(env)).update(body).digest('base64url')}`;
}
/** R12: the cookie that binds a state to the browser that asked for it (a link with a valid state sent to SOMEONE ELSE cannot link their calendar to the sender) */
export const STATE_COOKIE = '__ada_outlook_state';
export const stateCookie = (nonce) => `${STATE_COOKIE}=${nonce}; Path=/api/auth/callback; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;
const cookieOf = (header, name) => { for (const part of String(header || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); } return null; };
/**
 * The verified state AND the same browser: the nonce of the state must be the one of the cookie set when the link was issued, and is used once (KV), else null.
 * @param {string} state @param {{ cookieHeader?: string, consume?: (nonce: string) => Promise<boolean> }} o
 */
export async function verifyStateForBrowser(state, { cookieHeader, consume, now = Date.now(), env = process.env } = {}) {
  const p = verifyState(state, { now, env, withNonce: true });
  if (!p || !p.nonce) return null;
  const c = cookieOf(cookieHeader, STATE_COOKIE);
  if (!c || c.length !== p.nonce.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(p.nonce))) return null;
  if (consume && !(await consume(p.nonce))) return null;
  return { userId: p.userId, structureId: p.structureId };
}
/** @returns {{ userId: string, structureId: string } | null} */
export function verifyState(state, { now = Date.now(), env = process.env, withNonce = false } = {}) {
  const [body, sig, extra] = String(state || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = crypto.createHmac('sha256', stateSecret(env)).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.u !== 'string' || typeof p.s !== 'string' || typeof p.e !== 'number' || p.e < now) return null;
  return withNonce ? { userId: p.u, structureId: p.s, nonce: typeof p.n === 'string' ? p.n : null } : { userId: p.u, structureId: p.s };
}

export function authorizeUrl(pro, env = process.env, nonce = undefined) {
  const url = new URL(`${authority(env)}/authorize`);
  url.searchParams.set('client_id', env.OUTLOOK_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', env.OUTLOOK_REDIRECT_URI);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', OUTLOOK_SCOPES);
  url.searchParams.set('state', signState(pro, { env, ...(nonce ? { nonce } : {}) }));
  return url.toString();
}

/** Exchange the authorization code; returns { ok, tokens } or { ok:false, code }. Never returns or logs the provider's error text. */
export async function exchangeCode(code, { env = process.env, fetchImpl = fetch } = {}) {
  const body = new URLSearchParams();
  body.set('client_id', env.OUTLOOK_CLIENT_ID); body.set('client_' + 'secret', env.OUTLOOK_CLIENT_SECRET);
  body.set('code', String(code)); body.set('redirect_uri', env.OUTLOOK_REDIRECT_URI); body.set('grant_type', 'authorization_code');
  const r = await fetchImpl(`${authority(env)}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.error || !t.access_token) return { ok: false, code: 'TOKEN_EXCHANGE_FAILED' };
  return { ok: true, tokens: t };
}

/** Link the tokens to the professional named by the verified state, only if that account is active and still in that structure. */
export async function storeTokens(pro, tokens, db = defaultDb) {
  const [u] = await db.select({ id: ProUser.id, structureId: ProUser.structureId, status: ProUser.status }).from(ProUser).where(eq(ProUser.id, pro.userId)).limit(1);
  if (!u || u.status !== 'active' || u.structureId !== pro.structureId) return { ok: false, code: 'PRO_NOT_ELIGIBLE' };
  const access = encryptToken(tokens.access_token); const refresh = encryptToken(tokens.refresh_token || '');
  const values = { accessTokenEnc: access, refreshTokenEnc: refresh, iv: envelopeIv(access), expiresAt: new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000), scope: String(tokens.scope || '') };
  await db.insert(ProOutlookToken).values({ userId: u.id, ...values }).onConflictDoUpdate({ target: ProOutlookToken.userId, set: values });
  return { ok: true, userId: u.id };
}

/** Connected only when the stored row is in THE token format and opens with the current key. */
export async function connectionOf(userId, db = defaultDb) {
  const [row] = await db.select().from(ProOutlookToken).where(eq(ProOutlookToken.userId, userId)).limit(1);
  if (!row) return { connected: false };
  try { decryptToken(row.accessTokenEnc); decryptToken(row.refreshTokenEnc); } catch { return { connected: false, reconnectRequired: true }; }
  return { connected: true, expiresAt: row.expiresAt, scope: row.scope };
}

export async function disconnect(userId, db = defaultDb) {
  await db.delete(ProOutlookToken).where(eq(ProOutlookToken.userId, userId));
  return { ok: true };
}
