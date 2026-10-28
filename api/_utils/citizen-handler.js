// @ts-nocheck
import { requireCitizen, resolveCitizen } from './citizen-auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from './rateLimit.js';
import { describeDbError } from './errors.js';
import logger from './logger.js';

/**
 * PKG-1 / K0 shared wrapper: no-store, verified citizen session (cookie), per-user rate limit, uniform error shape. `fn(citizen, req, res)` returns the service result
 * ({ ok, status, ... } | { ok:false, status, code, message }) which is written as JSON. Mutations are protected by the global CSRF double-submit (cookie session, no Bearer).
 */
export function citizenHandler(name, methods, fn) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!methods.includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    const citizen = await requireCitizen(req, res);
    if (!citizen) return undefined;
    const limit = await checkRateLimit(req.method === 'GET' ? 'CITIZEN_ACCOUNT_READ' : 'CITIZEN_ACCOUNT_WRITE', `${citizen.id}:${getClientIp(req)}`);
    if (!limit.allowed) return res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' });
    try {
      const out = await fn(citizen, req, res);
      if (out === undefined) return undefined;
      if (out.ok === false) return res.status(out.status || 400).json({ error: out.code, message: out.message });
      const { ok: _ok, status, ...body } = out;
      return res.status(status || 200).json(body);
    } catch (error) {
      // the database's own diagnosis (SQLSTATE, constraint) without parameters or row data
      const err = describeDbError(error);
      // F6 (native run 20261018T192252Z-2ede5b): the account was erased while this request was in flight (account deletion / DSR erasure cascade). A write keyed on it then
      // violates the account foreign key. The session no longer names an account: that is a 401, not a server fault. Re-checked, never assumed (a lookup failure stays a 500).
      const cause = err.cause;
      if (cause && cause.code === '23503' && (await resolveCitizen(req).catch(() => undefined)) === null) {
        logger.warn({ err }, `[citizen/${name}] account no longer exists`);
        return res.status(401).json({ error: 'Unauthorized' });
      }
      logger.error({ err }, `[citizen/${name}] failed`);
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}
