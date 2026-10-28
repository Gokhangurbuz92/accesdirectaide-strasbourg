// @ts-nocheck
/**
 * Admin Logs endpoint — GET /api/admin/logs?count=50
 *
 * Returns recent centralized log entries from Redis.
 */
import { verifyAdmin } from '../../_utils/auth.js';
import { getLogs, logStoreConfigured } from '../../lib/log-store.js';

export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
    return res.status(500).json({ error: 'Failed to fetch logs', detail: err.message });
  }
}
