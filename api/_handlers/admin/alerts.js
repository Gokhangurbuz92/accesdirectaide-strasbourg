import { requireAdminAuth } from '../../_utils/auth.js';
import { kv } from '../../_utils/kv.js';
import { applyNoIndex } from '../../_utils/robots.js';

/**
 * Admin endpoint to view recent health alerts.
 * GET /api/admin/alerts
 *
 * Returns the last 50 alerts stored in KV by the health-alert cron.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  applyNoIndex(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const alerts = (await kv.get('alert:log')) || [];

  return res.status(200).json({
    ok: true,
    count: alerts.length,
    alerts,
  });
}

export default requireAdminAuth(handler);
