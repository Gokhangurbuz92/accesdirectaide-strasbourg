// @ts-nocheck
import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { liftByController, listRestrictions } from '../../_services/processing-restriction.js';

/**
 * PKG-11 / C21 — ADA's view of the active restrictions of processing (RGPD art. 18), behind the K5 administrator gate.
 *   GET  /api/admin/processing-restrictions            active restrictions (ground, since, masked account); named session with MFA
 *   POST /api/admin/processing-restrictions { id, reason }   ADA lifts one after informing the person (MFA; reason communicated; audited)
 */
export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: true }); if (!auth) return;
  try {
    const out = req.method === 'GET' ? await listRestrictions() : await liftByController(String(req.body?.id || ''), req.body || {}, String(auth.email));
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    const { ok: _ok, status, ...body } = out;
    return res.status(status || 200).json(body);
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code || error?.cause?.code } }, '[ProcessingRestrictions] failed');
    return res.status(500).json({ error: 'RESTRICTIONS_FAILED' });
  }
}
