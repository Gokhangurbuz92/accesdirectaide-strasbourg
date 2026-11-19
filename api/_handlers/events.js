// @ts-nocheck
/**
 * X04 (expansion) — the public reading of the academy pages and events (api/_services/academy-events.js). GET only, no account, nothing written, no
 * personal data in or out: a page, an event, its accessibility information and the number of places left. Closed by default: the router refuses the
 * route 503 CAPABILITY_NOT_OPEN before this handler while « community.events » is closed (api/_utils/capabilities.js), and the « events » surface is
 * opened by no deployment during the restricted beta (api/_utils/public-beta.js).
 *   GET /api/events?kind=LESSON|EVENT     { items }   published lessons / events that have not ended (cancelled ones marked), empty without migration 0053
 *   GET /api/events/<slug>                { item }    404 unknown or not published, 410 withdrawn
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { publicDetail, publicList } from '../_services/academy-events.js';
import logger from '../_utils/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
  const rate = await checkRateLimit('SEARCH_RESSOURCES', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  let path = '';
  try { path = new URL(String(req.url || '/'), 'http://x').pathname; } catch { path = ''; }
  const slug = path.replace(/^\/(api\/)?events\/?/, '').replace(/\/+$/, '');
  try {
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (slug) {
      const out = await publicDetail(decodeURIComponent(slug));
      if (!out) return res.status(404).json({ error: 'NOT_FOUND' });
      if (out.gone) return res.status(410).json({ error: 'WITHDRAWN' });
      return res.status(200).json(out);
    }
    const kind = String(req.query?.kind || 'EVENT').toUpperCase();
    if (!['LESSON', 'EVENT'].includes(kind)) return res.status(400).json({ error: 'BAD_KIND' });
    return res.status(200).json({ items: await publicList(kind) });
  } catch (e) {
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[events] failed');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
