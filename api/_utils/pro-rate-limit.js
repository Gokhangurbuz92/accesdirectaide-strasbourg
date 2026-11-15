// @ts-nocheck
/**
 * A23 (X10) — rate limits for the professional routes that only had `requireProAuth` / `requireProRole` (no quota at all: dossier read and export, 10 MB
 * uploads, model calls, team, reports, audit, Outlook…). api/index.js is byte-pinned, so the limit lives here, in the handler wrapper, AFTER authentication
 * (the budget is keyed on the authenticated member, never on an address):
 *
 *   requireProAuth(withProRateLimit('pro.dossier', handler))
 *   requireProRole(withProRateLimit('pro.reports', handler, { action: 'PRO_EXPORT' }), [...])
 *
 * Two existing limiters are reused, nothing new is invented:
 *   1. the tenant-scoped read / write quota every `withProRdvHandler` route already has (pro-rdv-rate-limit.js: PRO_RDV_RATE_LIMIT_READ_PER_MIN / WRITE_PER_MIN,
 *      one budget per member across the professional API);
 *   2. for costly routes, a tighter per-member budget of the shared limiter (rateLimit.js CONFIG): PRO_EXPORT (exports of dossiers, organisation data, reports,
 *      SIAO sheets), PRO_AI (model calls), PRO_UPLOAD (large bodies). `methods` restricts the tight budget to some methods (e.g. the POST of a GET+POST route);
 *      `when(req)` to some requests (e.g. the CSV variant of a report).
 * A refusal answers 429 (or the limiter's 503 when it fails closed in production) and the handler is never entered.
 */
import { enforceProRdvRateLimit } from './pro-rdv-rate-limit.js';
import { checkRateLimit, getRateLimitStatus } from './rateLimit.js';

export const PRO_TIGHT_ACTIONS = Object.freeze(['PRO_EXPORT', 'PRO_AI', 'PRO_UPLOAD']);

/**
 * @param {string} handlerName
 * @param {(req: any, res: any) => any} handler
 * @param {{ action?: 'PRO_EXPORT' | 'PRO_AI' | 'PRO_UPLOAD', methods?: string[], when?: (req: any) => boolean }} [options]
 */
export function withProRateLimit(handlerName, handler, options = {}) {
  const { action, methods, when } = options;
  if (action && !PRO_TIGHT_ACTIONS.includes(action)) throw new Error(`withProRateLimit: unknown action ${action}`);
  return async function proRateLimited(req, res) {
    const general = await enforceProRdvRateLimit(req, res, { handlerName });
    if (!general.allowed) return undefined;
    const method = String(req.method || 'GET').toUpperCase();
    if (action && (!methods || methods.includes(method)) && (!when || when(req))) {
      const userId = String(req.user?.userId || '').trim();
      const out = await checkRateLimit(action, `pro:${userId}`);
      if (!out.allowed) {
        const status = getRateLimitStatus(out);
        if (status === 429) res.setHeader('Retry-After', '60');
        return res.status(status).json({ ...(out.error || { error: 'Too Many Requests' }), code: status === 429 ? 'PRO_RATE_LIMITED' : (out.error?.code || 'RATE_LIMIT_ERROR'), scope: action });
      }
    }
    return handler(req, res);
  };
}
