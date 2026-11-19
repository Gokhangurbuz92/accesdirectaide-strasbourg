/**
 * G8 — GET /api/public/indicators: the public indicators of the Observatoire (api/lib/public-indicators.js). Read-only, anonymous, aggregates only.
 * CLOSED unless ADA_PUBLIC_INDICATORS=open: while closed it answers 404 as if the route did not exist (in every environment, Production included).
 * The values are computed at most every 6 hours per instance and dated (computedAt): the page says « calculé le … ». Every answer passes
 * assertAggregateOnly() first — a body holding a row-level field, an e-mail, a link or a phone number is never sent (500 instead).
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { assertAggregateOnly, publicIndicatorsOpen } from '../../lib/public-indicators.js';

export const TTL_MS = 6 * 3600 * 1000;
/** @type {{ at: number, body: any } | null} */
let cache = null;

/** @param {any} req @param {any} res @param {{ compute?: () => Promise<any> }} [deps] */
export default async function handler(req, res, deps = {}) {
  if (!publicIndicatorsOpen()) return res.status(404).json({ error: 'Not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader?.('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Method not allowed' }); }
  const rl = await checkRateLimit('PUBLIC_INDICATORS', getClientIp(req));
  if (rl && rl.allowed === false) return res.status(getRateLimitStatus(/** @type {any} */ (rl))).json(rl.error || { error: 'Trop de demandes.', code: 'RATE_LIMITED' });
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const compute = deps.compute || (async () => (await import('../../_services/public-indicators.js')).computePublicIndicators());
      const body = await compute();
      assertAggregateOnly(body);
      cache = { at: Date.now(), body };
    }
    res.setHeader?.('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return res.status(200).json(cache.body);
  } catch (error) {
    logger.error({ err: { name: /** @type {any} */ (error)?.name } }, '[PublicIndicators] failed');
    return res.status(500).json({ error: 'INDICATORS_UNAVAILABLE' });
  }
}

/** tests only */
export const _resetIndicatorsCache = () => { cache = null; };
