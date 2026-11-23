/**
 * G14-OBS — POST /api/public/signal: the OPT-IN, cookie-less counter of a Rights Graph situation (/situation). The page calls it only after the visitor
 * ticked « help the observatory » (src/lib/demandSignal.js); without that box the page sends nothing, as the privacy notice says of browser-only pages.
 *
 * Body: exactly { "situation": "<id of the closed list>" } — any other field is refused (400 FIELD_NOT_ALLOWED, names only), an unknown id too
 * (400 UNKNOWN_SITUATION: the list is public). The body (not the address) carries the id, so the host's access logs never see it. Nothing is read from
 * the request but that field and the address used by the rate limiter (PUBLIC_SIGNAL, 10 / minute; the limiter keeps a key for one minute, as for every
 * route). Nothing is stored but « +1 for this id today » (api/_services/demand-signals.js): no identifier, no address, no time of day, no cookie set.
 * CLOSED (404) unless ADA_DEMAND_SIGNALS names « situation ». Answers 204 with no body.
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { SITUATIONS, signalRecorded } from '../../lib/demand-signals.js';

/** @param {any} req @param {any} res @param {{ record?: (id: string) => Promise<number> }} [deps] */
export default async function handler(req, res, deps = {}) {
  if (!signalRecorded('situation')) return res.status(404).json({ error: 'Not found' });
  if (req.method !== 'POST') { res.setHeader?.('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  res.setHeader?.('Cache-Control', 'no-store');
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ error: 'INVALID_BODY' });
  const extra = Object.keys(body).filter((k) => k !== 'situation');
  if (extra.length) return res.status(400).json({ error: 'FIELD_NOT_ALLOWED', fields: extra.slice(0, 10).map((k) => String(k).slice(0, 40)) });
  const id = typeof body.situation === 'string' ? body.situation : '';
  if (!Object.prototype.hasOwnProperty.call(SITUATIONS, id)) return res.status(400).json({ error: 'UNKNOWN_SITUATION' });
  const rl = await checkRateLimit('PUBLIC_SIGNAL', getClientIp(req));
  if (rl && rl.allowed === false) return res.status(getRateLimitStatus(/** @type {any} */ (rl))).json(rl.error || { error: 'Trop de demandes.', code: 'RATE_LIMITED' });
  const record = deps.record || (async (/** @type {string} */ s) => (await import('../../_services/demand-signals.js')).recordSituation(s));
  await record(id);
  return res.status(204).end();
}
