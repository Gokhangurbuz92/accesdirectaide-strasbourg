import { requireAdminAuth } from '../../_utils/auth.js';
import { getMetrics } from '../../lib/gemini-metrics.js';
import { getLocalAiMetrics } from '../../lib/local-ai-metrics.js';
import { applyNoIndex } from '../../_utils/robots.js';

/**
 * Admin-only endpoint to view AI metrics.
 * GET /api/admin/ai-metrics
 * PKG-6 / A14: `local` = real runs of the local model (assistant, FALC), latency percentiles, reason codes, RAG coverage; null if unavailable.
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

  const [metrics, local] = await Promise.all([getMetrics(), getLocalAiMetrics().catch(() => null)]);
  return res.status(200).json({ ...metrics, local });
}

export default requireAdminAuth(handler);
