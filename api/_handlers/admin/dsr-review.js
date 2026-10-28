// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { confirm, listOpen, propose, readForReview } from '../../_services/dsr-review.js';

/**
 * PKG-4 — human review of organization-held internal notes in an access request (api/_services/dsr-review.js).
 *   GET  /api/admin/dsr-review              open reviews (any admin; no content)
 *   GET  /api/admin/dsr-review?id=          the notes under review — named admin session WITH MFA only; the reading is audited
 *   POST /api/admin/dsr-review { id, decision: RELEASE|WITHHOLD, basis, extract }      first reviewer PROPOSES (named admin session WITH MFA)
 *   POST /api/admin/dsr-review { id, action: confirm|send_back, note }                a SECOND, different MFA reviewer makes it final or sends it back
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await resolveAuthContext(req);
  // PKG-5 / A16: administrator sessions only — a professional token claiming SUPERADMIN is not an administrator
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query?.id || '');
  const mfa = auth.authType === 'admin_jwt' && auth.mfa_verified === true && auth.email;
  try {
    if (req.method === 'GET' && !id) return res.status(200).json(await listOpen());
    if (!mfa) return res.status(403).json({ error: 'HUMAN_MFA_SESSION_REQUIRED', message: 'Reviewing requires a named administrator session with MFA.' });
    const out = req.method === 'GET' ? await readForReview(id, String(auth.email)) : (req.body?.action ? await confirm(String(req.body?.id || ''), req.body || {}, String(auth.email)) : await propose(String(req.body?.id || ''), req.body || {}, String(auth.email)));
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[DsrReview] failed');
    return res.status(500).json({ error: 'REVIEW_FAILED' });
  }
}
