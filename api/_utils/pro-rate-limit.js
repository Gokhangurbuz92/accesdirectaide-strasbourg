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
 *
 * R47-QA (native QA v40, DTA-B49): `budget: 'session'` — the reads every professional PAGE makes by itself, whatever the page (the session check GET /api/pro/me,
 * the two notification centres of the layout, the unread count), count in a per-member bucket of their own: PRO_SESSION_READ_FACTOR times the read budget.
 * In the shared read budget they cost about four reads per page change, so a member going through a dozen pages in a minute had the session check refused
 * (429) and the layout said « L'espace professionnel est momentanément indisponible »; the page reads also lost their budget to them. The bucket stays bounded
 * (a member still cannot read without limit) and writes keep the shared write budget.
 */
import { enforceProRdvRateLimit } from './pro-rdv-rate-limit.js';
import { checkRateLimit, getRateLimitStatus } from './rateLimit.js';
import { env } from './env.js';

export const PRO_TIGHT_ACTIONS = Object.freeze(['PRO_EXPORT', 'PRO_AI', 'PRO_UPLOAD']);
/** the per-member bucket of the reads every page makes by itself (`budget: 'session'`) = this factor × PRO_RDV_RATE_LIMIT_READ_PER_MIN */
export const PRO_SESSION_READ_FACTOR = 3;

/**
 * @param {string} handlerName
 * @param {(req: any, res: any) => any} handler
 * @param {{ action?: 'PRO_EXPORT' | 'PRO_AI' | 'PRO_UPLOAD', methods?: string[], when?: (req: any) => boolean, budget?: 'session' }} [options]
 */
export function withProRateLimit(handlerName, handler, options = {}) {
  const { action, methods, when, budget } = options;
  if (action && !PRO_TIGHT_ACTIONS.includes(action)) throw new Error(`withProRateLimit: unknown action ${action}`);
  if (budget !== undefined && budget !== 'session') throw new Error(`withProRateLimit: unknown budget ${budget}`);
  return async function proRateLimited(req, res) {
    const general = await enforceProRdvRateLimit(req, res, budget === 'session'
      ? { handlerName, readBucket: { name: 'session', perMinute: env.proRdv.readPerMinute * PRO_SESSION_READ_FACTOR } }
      : { handlerName });
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
