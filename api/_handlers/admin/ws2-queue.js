// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { ws2Queue } from '../../_services/ws2-review.js';

/** PKG-5 — GET /api/admin/ws2-queue: the WS2 closure queue (administrator sessions). Verifying a record = POST /api/admin/content-verification (MFA). */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await resolveAuthContext(req);
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });
  try { return res.status(200).json(await ws2Queue()); }
  catch (error) { logger.error({ err: { name: error?.name } }, '[Ws2Queue] failed'); return res.status(500).json({ error: 'WS2_QUEUE_FAILED' }); }
}
