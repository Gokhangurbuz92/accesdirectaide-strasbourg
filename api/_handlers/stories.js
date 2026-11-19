// @ts-nocheck
/**
 * X01 (expansion) — the public reading of the published community stories (api/_services/community-stories.js). GET only, no account, nothing written: the
 * PSEUDONYM, the title, the text, its language, the publication date and an opaque story id (to report it) — never an account, an e-mail, a member id or a
 * moderator. Cache-Control: no-store — a story the person withdraws (or a moderator takes down) is gone from the next answer, no cache keeps it.
 * Closed by default: the router refuses the route 503 CAPABILITY_NOT_OPEN before this handler while « community.stories » is closed
 * (api/_utils/capabilities.js), and the « stories » surface is opened by no deployment during the restricted beta (api/_utils/public-beta.js).
 *   GET /api/stories     { items }   empty without migration 0055 — and empty until real persons write and a moderator approves (no sample)
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { publicStories } from '../_services/community-stories.js';
import logger from '../_utils/logger.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
  const rate = await checkRateLimit('SEARCH_RESSOURCES', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  try {
    return res.status(200).json({ items: await publicStories() });
  } catch (e) {
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[stories] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
