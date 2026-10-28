// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { confirmErasure, listOpenErasures, proposeErasure, readErasure, retryBlockedErasure } from '../../_services/dsr-erasure-review.js';

/**
 * PKG-11 / C21 — two-person review of account erasure requests (api/_services/dsr-erasure-review.js).
 *   GET  /api/admin/dsr-erasure              open requests (any admin; no content)
 *   GET  /api/admin/dsr-erasure?id=          what the deletion would touch (counts, legal holds) — named admin session WITH MFA; the reading is audited
 *   POST /api/admin/dsr-erasure { id, decision: APPROVE|REJECT, reason }        first reviewer PROPOSES (MFA)
 *   POST /api/admin/dsr-erasure { id, action: confirm|send_back, note, proposedAt }   a SECOND, different MFA reviewer; confirm+APPROVE runs the deletion
 *   POST /api/admin/dsr-erasure { id, action: retry }                         a request BLOCKED by a legal hold, after the hold is released (MFA)
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await resolveAuthContext(req);
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query?.id || '');
  const mfa = auth.authType === 'admin_jwt' && auth.mfa_verified === true && auth.email;
  try {
    if (req.method === 'GET' && !id) return res.status(200).json(await listOpenErasures());
    if (!mfa) return res.status(403).json({ error: 'HUMAN_MFA_SESSION_REQUIRED', message: 'Reviewing requires a named administrator session with MFA.' });
    const body = req.body || {}; const reviewer = String(auth.email); const target = String(body.id || '');
    const out = req.method === 'GET' ? await readErasure(id, reviewer)
      : body.action === 'retry' ? await retryBlockedErasure(target, reviewer)
        : body.action ? await confirmErasure(target, body, reviewer)
          : await proposeErasure(target, body, reviewer);
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code } }, '[DsrErasure] failed');
    return res.status(500).json({ error: 'ERASURE_REVIEW_FAILED' });
  }
}
