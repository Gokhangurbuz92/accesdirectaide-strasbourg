import crypto from 'crypto';
import { db } from '../../src/db/index.js';
import { CitizenUser } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { getSecureCookieOptions } from './security.js';
import { signJwt, verifyJwt } from '../_utils/auth.js';
import { env } from './env.js';
import { hashPassword, hashPasswordSync, verifyPassword } from './password-hash.js';
import { clientIp } from './client-ip.js';

export const USER_SESSION_COOKIE_NAME = 'ada_user_session';

const USER_SESSION_ISSUER = 'accesdirectaide';
const USER_SESSION_AUDIENCE = 'accesdirectaide-user';
const USER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/[^\d+]/g, '').slice(0, 24);
}

/**
 * @param {string} value
 * @returns {string}
 */
export function hashAuthToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * @returns {string}
 */
export function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

// the password hash format lives in password-hash.js (no database or environment import: scripts/admin-bootstrap.mjs uses it alone)
export { hashPassword, hashPasswordSync, verifyPassword };

/**
 * PKG-11 audit pass 2: a password nobody has chosen yet (a sign-up for an address whose account is still unverified, an ownership recovery). It never verifies
 * (not an scrypt hash); the person who proves the mailbox by clicking the verification link chooses the password at that moment (verify-email → /auth/reset).
 */
export const UNSET_PASSWORD_PREFIX = 'unset:';
export const unsetPasswordHash = () => `${UNSET_PASSWORD_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
export const isUnsetPassword = (/** @type {unknown} */ passwordHash) => String(passwordHash || '').startsWith(UNSET_PASSWORD_PREFIX);

/**
 * @returns {string | undefined}
 */
function getUserSessionSecret() {
  return env.auth.secret || env.secrets.jwtSecret;
}

/**
 * @param {{ userId: string, email: string }} payload
 * @returns {string}
 */
export function signUserSessionToken(payload) {
  const secret = getUserSessionSecret();
  if (!secret) {
    throw new Error('Missing user auth signing secret (AUTH_SECRET/AUTH_JWT_SECRET/JWT_SECRET)');
  }

  return signJwt(
    {
      scope: 'user',
      role: 'user',
      userId: String(payload.userId || ''),
      email: normalizeEmail(payload.email),
      iat_ms: Date.now(),   // PKG-11 audit pass 2: issue time to the millisecond (iat is whole seconds), see citizenSessionRevoked
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: `${USER_SESSION_MAX_AGE_SECONDS}s`,
      issuer: USER_SESSION_ISSUER,
      audience: USER_SESSION_AUDIENCE,
    },
  );
}

/**
 * PKG-11 audit: a citizen session issued before CitizenUser.sessionsValidAfter is refused (password reset, ownership recovery, logout) — the same rule as the
 * professional sessions (proSessionRevoked). Audit pass 2: tokens carry their issue time to the millisecond (iat_ms), compared exactly — a session issued earlier
 * in the same second as a reset or a logout is revoked, one issued just after it is not (pass 1 moved the marker 1 s ahead, which also revoked a login made right
 * after a reset). Tokens without iat_ms (issued before this change) keep the whole-second rule: those of that same second stay valid.
 * @param {number | undefined} iat @param {Date | string | null | undefined} sessionsValidAfter @param {number} [iatMs]
 */
export function citizenSessionRevoked(iat, sessionsValidAfter, iatMs) {
  const after = sessionsValidAfter ? new Date(sessionsValidAfter).getTime() : NaN;
  if (!Number.isFinite(after)) return false;
  if (typeof iatMs === 'number' && Number.isFinite(iatMs)) return iatMs < after;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return true;
  return iat < Math.floor(after / 1000);
}

/**
 * @param {string | null | undefined} token
 * @returns {null | { userId: string, email: string, role: 'user', scope: 'user', iat?: number, iatMs?: number }}
 */
export function verifyUserSessionToken(token) {
  if (!token) return null;
  const secret = getUserSessionSecret();
  if (!secret) return null;

  try {
    const decoded = verifyJwt(String(token), secret, {
      algorithms: ['HS256'],
      issuer: USER_SESSION_ISSUER,
      audience: USER_SESSION_AUDIENCE,
    });

    if (!decoded || typeof decoded !== 'object') return null;
    const payload = /** @type {Record<string, any>} */ (decoded);
    const scope = String(payload.scope || '');
    const role = String(payload.role || '');
    const userId = String(payload.userId || '').trim();
    const email = normalizeEmail(payload.email);

    if (scope !== 'user' || role !== 'user' || !userId || !email) return null;
    return { userId, email, role: 'user', scope: 'user', iat: typeof payload.iat === 'number' ? payload.iat : undefined, iatMs: typeof payload.iat_ms === 'number' ? payload.iat_ms : undefined };   // see citizenSessionRevoked
  } catch {
    return null;
  }
}

/**
 * @param {import('./http-types').ApiRequest} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  /** @type {Record<string, string>} */
  const output = {};

  if (req && req.cookies && typeof req.cookies === 'object') {
    for (const [key, value] of Object.entries(req.cookies)) {
      if (!key) continue;
      output[key] = String(value || '');
    }
  }

  const rawHeader = req?.headers?.cookie || req?.headers?.Cookie;
  const raw = Array.isArray(rawHeader) ? rawHeader.join(';') : String(rawHeader || '');
  if (!raw) return output;

  for (const part of raw.split(';')) {
    const [namePart, ...valueParts] = part.split('=');
    const name = String(namePart || '').trim();
    if (!name) continue;
    const value = String(valueParts.join('=') || '').trim();
    try {
      output[name] = decodeURIComponent(value);
    } catch {
      output[name] = value;
    }
  }

  return output;
}

/**
 * @param {import('./http-types').ApiRequest} req
 * @returns {string | null}
 */
export function getUserSessionTokenFromRequest(req) {
  const cookies = parseCookies(req);
  const value = String(cookies[USER_SESSION_COOKIE_NAME] || '').trim();
  return value || null;
}

/**
 * @param {string} token
 * @param {{ maxAgeSeconds?: number }=} options
 * @returns {string}
 */
export function buildUserSessionCookie(token, options = {}) {
  const maxAge = Number(options.maxAgeSeconds || USER_SESSION_MAX_AGE_SECONDS);
  const encoded = encodeURIComponent(String(token || ''));
  const secureOpts = getSecureCookieOptions();
  return `${USER_SESSION_COOKIE_NAME}=${encoded}; ${secureOpts}; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function buildUserSessionCookieClear() {
  const secureOpts = getSecureCookieOptions();
  return `${USER_SESSION_COOKIE_NAME}=; ${secureOpts}; Max-Age=0`;
}

/**
 * @param {unknown} value
 * @param {string=} fallback
 * @returns {string}
 */
export function normalizeNextPath(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  if (!decoded.startsWith('/')) return fallback;
  if (decoded.startsWith('//')) return fallback;
  return decoded;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function buildAppUrl(path) {
  const configured = String(env.runtime.appBaseUrl || '').trim();
  // production never writes a link to localhost (verification, reset, appointments, invitations): without the public https address the action is refused and
  // the release preflight fails (launch-readiness item 41)
  if ((process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') && !/^https:\/\/(?!localhost\b|127\.0\.0\.1\b)[^/\s]+/i.test(configured)) {
    throw Object.assign(new Error('APP_BASE_URL (https) is required in production'), { code: 'APP_BASE_URL_MISSING' });
  }
  const base = configured || 'http://localhost:3000';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${String(path || '')}`;
  return new URL(cleanPath, normalizedBase).toString();
}

/**
 * Allowlist of domains that are safe redirect targets.
 * Everything else is rewritten to '/' to prevent open redirect attacks.
 */
const ALLOWED_REDIRECT_HOSTS = new Set([
  'accesdirectaide.fr',
  'www.accesdirectaide.fr',
]);

/**
 * Validate a redirect URL to prevent open redirect attacks.
 * Only allows:
 *  - Relative paths (starts with '/' but not '//')
 *  - Absolute URLs to allowed hosts
 *
 * @param {string} location
 * @param {string} fallback
 * @returns {string}
 */
export function safeRedirectUrl(location, fallback = '/') {
  if (typeof location !== 'string' || !location.trim()) return fallback;
  const loc = location.trim();

  // Relative path — safe (normalizeNextPath already blocks '//')
  if (loc.startsWith('/') && !loc.startsWith('//')) return loc;

  // Absolute URL — validate host against allowlist
  try {
    const parsed = new URL(loc);
    if (ALLOWED_REDIRECT_HOSTS.has(parsed.hostname)) return loc;
  } catch {
    // Malformed URL — reject
  }

  return fallback;
}

/**
 * @param {import('./http-types').ApiResponse} res
 * @param {string} location
 * @param {number=} statusCode
 */
export function redirect(res, location, statusCode = 302) {
  const code = Number(statusCode || 302);
  const safeLocation = safeRedirectUrl(location);

  if (typeof res.redirect === 'function') {
    return res.redirect(code, safeLocation);
  }
  if (typeof res.writeHead === 'function') {
    res.writeHead(code, { Location: safeLocation });
    return res.end();
  }
  res.status(code);
  res.setHeader('Location', safeLocation);
  return res.end();
}

/**
 * @param {import('./http-types').ApiRequest} req
 * @returns {string}
 */
export function getClientIp(req) {
  return clientIp(req);   // launch-readiness item 48 (api/_utils/client-ip.js)
}

