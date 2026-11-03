// @ts-nocheck
/**
 * Admin Logs endpoint — GET /api/admin/logs?count=50
 *
 * Returns recent centralized log entries from Redis.
 */
import { verifyAdmin } from '../../_utils/auth.js';
import { getLogs, logStoreConfigured } from '../../lib/log-store.js';
import { refuseWithoutAdminMfa } from '../../_utils/admin-personal-data.js';

export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // R40: application logs can hold personal data — MFA session only
  if (!(await verifyAdmin(req, { personalData: true }))) return refuseWithoutAdminMfa(res);

  const count = Math.min(parseInt(req.query?.count, 10) || 50, 500);
  const level = req.query?.level; // optional filter: 'error', 'warn', etc.

  try {
    let logs = await getLogs(count);

    if (level) {
      logs = logs.filter((l) => l.level === level);
    }

    return res.status(200).json({
      ok: true,
      stored: logStoreConfigured(),
      count: logs.length,
      logs,
    });
  } catch (err) {
    void err;   // R40: no internal error text in the answer
    return res.status(500).json({ error: 'Failed to fetch logs' });
  }
}
