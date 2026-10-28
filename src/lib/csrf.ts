/**
 * CSRF Double-Submit Cookie — Frontend Utility
 *
 * Reads the `__csrf` cookie set by the backend and returns
 * the matching `x-csrf-token` header for inclusion in fetch() calls.
 *
 * Usage:
 *   fetch('/api/endpoint', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
 *     body: JSON.stringify(payload),
 *   });
 */

/**
 * Read the __csrf cookie value from document.cookie.
 * Returns an empty object if the cookie is not yet set (first visit before any API call).
 */
export function getCsrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return match ? { 'x-csrf-token': match[1] } : {};
}

export class CsrfBootstrapError extends Error {
  constructor() { super('csrf_bootstrap_failed'); this.name = 'CsrfBootstrapError'; }
}

// The ONLY refusals that are a CSRF-token refusal (api/_utils/csrf.js). The SEC-03 origin refusal also says "CSRF protection" and must never be retried.
const CSRF_TOKEN_REFUSAL = /^(Missing CSRF token|CSRF token mismatch)/;

/**
 * Protected request with the double-submit header.  DTA S1D: the server issues a fresh `__csrf` token to EVERY request that arrives without the cookie, so two concurrent first requests
 * (e.g. the SPA's own GET /api/auth/me and the bootstrap GET /api/health) can each issue a different token and the later Set-Cookie replaces the earlier one — possibly between our cookie read
 * and the moment the browser attaches the Cookie header.  The server refuses such a request BEFORE any handler runs (no side effect), so exactly one retry with the cookie as it is now is safe.
 * Never retried: origin refusals, authorization refusals, an unchanged cookie, a second refusal.  Throws CsrfBootstrapError (no request sent) when no cookie can be obtained.
 */
export async function csrfFetch(url: string, init: Parameters<typeof fetch>[1] = {}): Promise<Response> {
  const first = await ensureCsrfHeaders();
  if (!first) throw new CsrfBootstrapError();
  const send = (csrf: Record<string, string>) => fetch(url, { ...init, headers: { ...((init.headers as Record<string, string>) || {}), ...csrf } });
  const res = await send(first);
  if (res.status !== 403) return res;
  let tokenRefusal = false;
  try {
    const body = await res.clone().json();
    tokenRefusal = !!body && body.error === 'Forbidden' && CSRF_TOKEN_REFUSAL.test(String(body.message || ''));
  } catch { /* not JSON: not a CSRF refusal */ }
  if (!tokenRefusal) return res;
  const now = getCsrfHeaders();
  if (!now['x-csrf-token'] || now['x-csrf-token'] === first['x-csrf-token']) return res;
  return send(now);
}

let bootstrapInFlight: Promise<Record<string, string> | null> | null = null;

/**
 * First-visit safe variant of getCsrfHeaders() for the FIRST protected POST of a page (e.g. a shared-diagnostic link opened in a fresh browser).
 * The server issues the (script-readable) __csrf cookie on every /api response that passes its checks, including the exempt GET /api/health (api/index.js ensureCsrfCookie).
 * If the cookie is missing we make ONE plain same-origin GET to /api/health (concurrent callers share it), then read the cookie.
 * Returns null when no cookie could be obtained: the caller must NOT send the protected request in that case. Server-side CSRF enforcement is unchanged.
 */
export async function ensureCsrfHeaders(): Promise<Record<string, string> | null> {
  const have = getCsrfHeaders();
  if (have['x-csrf-token']) return have;
  if (typeof fetch === 'undefined') return null;
  if (!bootstrapInFlight) {
    bootstrapInFlight = (async () => {
      try {
        await fetch('/api/health', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
      } catch {
        return null;
      }
      const after = getCsrfHeaders();
      return after['x-csrf-token'] ? after : null;
    })().finally(() => { bootstrapInFlight = null; });
  }
  return bootstrapInFlight;
}
