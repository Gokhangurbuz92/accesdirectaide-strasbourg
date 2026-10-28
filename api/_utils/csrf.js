// @ts-nocheck
import { randomUUID } from 'crypto';
import { getSecureCookieOptions } from './security.js';

/**
 * CSRF Double-Submit Cookie Middleware.
 *
 * Pattern:
 * 1. On any response, if no __csrf cookie exists, set one with a random token
 * 2. On state-changing requests (POST/PUT/PATCH/DELETE), validate that the
 *    `x-csrf-token` header matches the `__csrf` cookie value
 *
 * Exemptions:
 * - /health, /healthz, /health/deep (monitoring)
 * - /cron/* (server-to-server, uses CRON_SECRET)
 * - /monitor/* (public monitoring)
 * - Requests with Authorization: Bearer (API-to-API with JWT)
 *
 * @param {import('./http-types').ApiRequest} req
 * @param {import('./http-types').ApiResponse} res
 * @returns {{ ok: boolean, error?: string }}
 */
export function csrfCheck(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const path = (req.url || '').replace(/^\/api\//, '/').replace(/\?.*$/, '');

  // Exempt paths: health, cron, monitor, webhooks, login endpoints
  const exemptPrefixes = ['/health', '/healthz', '/cron/', '/monitor/', '/docs/', '/auth/login', '/pro/auth/login', '/search-pro', '/contact', '/feedback'];
  if (exemptPrefixes.some(p => path.startsWith(p))) {
    return { ok: true };
  }

  // Exempt API-to-API calls with Bearer token (JWT auth covers these)
  const authHeader = req.headers?.['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return { ok: true };
  }

  // Only enforce on state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    // For GET requests, set the CSRF cookie if not present
    ensureCsrfCookie(req, res);
    return { ok: true };
  }

  // Parse cookies
  const cookies = parseCookies(req.headers?.cookie || '');
  const cookieToken = cookies['__csrf'];
  const headerToken = req.headers?.['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return {
      ok: false,
      error: 'Missing CSRF token. Include x-csrf-token header matching __csrf cookie.',
    };
  }

  if (cookieToken !== headerToken) {
    return {
      ok: false,
      error: 'CSRF token mismatch.',
    };
  }

  return { ok: true };
}

/**
 * Attributes of the __csrf cookie.  Double-submit REQUIRES the page script to read the value
 * (src/lib/csrf.ts and src/api/client.js read document.cookie), so this cookie must NOT be HttpOnly:
 * an HttpOnly copy is invisible to the browser, the x-csrf-token header is never sent and every
 * cookie-session mutation (e.g. the citizen sharing panel) is refused with 403.  The token is not a
 * credential: it only proves the caller can read same-origin cookies; the session cookies stay
 * HttpOnly, and the Origin gate (SEC-03) is unchanged.  Lax (not Strict): cross-site sub-requests
 * (POST/AJAX) do not carry it.  Secure follows the environment like the other cookies.
 */
export function getCsrfCookieOptions() {
  return getSecureCookieOptions().split('; ').filter((p) => p !== 'HttpOnly').join('; ').replace('SameSite=Strict', 'SameSite=Lax');
}

/**
 * Set __csrf cookie if not already present.
 * @param {import('./http-types').ApiRequest} req
 * @param {import('./http-types').ApiResponse} res
 */
export function ensureCsrfCookie(req, res) {
  const cookies = parseCookies(req.headers?.cookie || '');
  if (!cookies['__csrf']) {
    const token = randomUUID();
    res.setHeader('Set-Cookie', [
      `__csrf=${token}; ${getCsrfCookieOptions()}; Max-Age=86400`,
    ]);
  }
}

/**
 * @param {string} cookieHeader
 * @returns {Record<string, string>}
 */
function parseCookies(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) {
      result[key.trim()] = rest.join('=').trim();
    }
  }
  return result;
}
