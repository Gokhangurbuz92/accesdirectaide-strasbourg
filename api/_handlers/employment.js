// @ts-nocheck
/**
 * X05 (expansion) — the public reading of the inclusive job board (api/_services/job-board.js). GET only, no account, NOTHING written or logged about the
 * reader: published listings whose end date has not passed, of employers that are still active and verified by ADA (E01). Each listing gives the employer's
 * OWN application channel: the person applies there directly — ADA receives and stores nothing about applicants. Cache-Control: no-store — a listing the
 * employer withdraws, the moderation takes down, or whose employer loses its verification, is gone from the next answer.
 * Closed by default: the router refuses the route 503 CAPABILITY_NOT_OPEN before this handler while « community.employment » is closed
 * (api/_utils/capabilities.js), and the « employment » surface is opened by no deployment during the restricted beta (api/_utils/public-beta.js).
 *   GET /api/employment     { items }   empty without migration 0056 — and empty until a verified employer writes and a moderator approves (no sample)
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { publicListings } from '../_services/job-board.js';
import logger from '../_utils/logger.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
  const rate = await checkRateLimit('SEARCH_RESSOURCES', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  try {
    return res.status(200).json({ items: await publicListings() });
  } catch (e) {
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[employment] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
