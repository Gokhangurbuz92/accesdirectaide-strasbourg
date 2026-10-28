import { randomUUID } from 'crypto';
import { getActualitesCronFreshness } from '../../_utils/cron-freshness.js';
import { applyNoIndex } from '../../_utils/robots.js';

/**
 * Public uptime-friendly endpoint for external monitors.
 * Returns 200 only when cron "actualites" freshness is healthy.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();

  res.setHeader('x-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  applyNoIndex(res);

  try {
    const freshness = await getActualitesCronFreshness();

    // Return 200 always — freshness state is informational, not a reason to alarm.
    // The `ok` and `state` fields communicate the actual health.
    return res.status(200).json({
      ok: freshness.state === 'fresh',
      job: 'actualites',
      state: freshness.state,
      ageMinutes: freshness.ageMinutes,
      lastSuccessAt: freshness.lastSuccessAt,
      thresholds: freshness.thresholds,
      requestId,
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      job: 'actualites',
      state: 'error',
      ageMinutes: null,
      lastSuccessAt: null,
      thresholds: null,
      requestId,
      error: 'freshness_check_failed',
    });
  }
}
