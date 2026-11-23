/**
 * G14-OBS — GET /api/public/observatoire: the public observatoire for institutions and anyone (read-only, anonymous, aggregates only).
 *   ?format=json (default)  schema ada.observatoire.v1 (api/_services/demand-signals.js publicObservatoire)
 *   ?format=csv             the same published cells as open data (Licence Ouverte 2.0), one tidy line per cell (api/lib/demand-signals.js observatoireCsv)
 * Any other query parameter is refused before anything is read (400 QUERY_PARAMETER_NOT_ACCEPTED): two reads that differ by a filter must not exist.
 * CLOSED unless ADA_OBSERVATOIRE=open: while closed it answers 404 as if the route did not exist. Rate-limited (PUBLIC_OBSERVATOIRE, 30 / minute / address);
 * computed at most once an hour per instance (frozen quarters never change; the supply map is the public directory). Every JSON answer passes
 * assertAggregateOnly() first — a body holding a row-level field, an e-mail, a link or a phone number is never sent (500 instead).
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { assertAggregateOnly } from '../../lib/public-indicators.js';
import { observatoireCsv, observatoireOpen } from '../../lib/demand-signals.js';

export const TTL_MS = 3600 * 1000;
/** @type {{ at: number, body: any } | null} */
let cache = null;
const FORMATS = new Set(['json', 'csv']);

/** @param {any} req @param {any} res @param {{ compute?: () => Promise<any> }} [deps] */
export default async function handler(req, res, deps = {}) {
  if (!observatoireOpen()) return res.status(404).json({ error: 'Not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader?.('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Method not allowed' }); }
  const query = req.query || {};
  const extra = Object.keys(query).filter((k) => k !== 'format');
  const format = query.format === undefined ? 'json' : String(query.format);
  if (extra.length || !FORMATS.has(format)) return res.status(400).json({ error: 'QUERY_PARAMETER_NOT_ACCEPTED', accepted: ['format=json', 'format=csv'] });
  const rl = await checkRateLimit('PUBLIC_OBSERVATOIRE', getClientIp(req));
  if (rl && rl.allowed === false) return res.status(getRateLimitStatus(/** @type {any} */ (rl))).json(rl.error || { error: 'Trop de demandes.', code: 'RATE_LIMITED' });
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const compute = deps.compute || (async () => (await import('../../_services/demand-signals.js')).publicObservatoire());
      const body = await compute();
      assertAggregateOnly(body);
      cache = { at: Date.now(), body };
    }
    res.setHeader?.('Cache-Control', 'public, max-age=300, s-maxage=3600');
    if (format === 'csv') {
      res.setHeader?.('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader?.('Content-Disposition', 'attachment; filename="observatoire-eurometropole-strasbourg.csv"');
      return res.status(200).send(observatoireCsv(cache.body));
    }
    return res.status(200).json(cache.body);
  } catch (error) {
    logger.error({ err: { name: /** @type {any} */ (error)?.name } }, '[Observatoire] failed');
    return res.status(500).json({ error: 'OBSERVATOIRE_UNAVAILABLE' });
  }
}

/** tests only */
export const _resetObservatoireCache = () => { cache = null; };
