// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { decide, reviewQueue } from '../../_services/structure-proposals.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/**
 * PKG-4 / E02 — ADA review of the profile changes structures propose.
 *   GET  /api/admin/structure-proposals?status=PENDING          (any admin)
 *   POST /api/admin/structure-proposals { id, decision: ACCEPT|REJECT, note, sourceUrl, territoryConfirmed }   named administrator session WITH MFA only (same rule as content verification);
 *   accepting needs an official https source; a geography change withdraws territory_verified unless territoryConfirmed (D-5, never bypassed)
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await resolveAuthContext(req);
  // PKG-5 / A16: administrator sessions only — a professional token claiming SUPERADMIN is not an administrator
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') return res.status(200).json(await reviewQueue(undefined, { status: String(req.query?.status || 'PENDING') }));
    if (auth.authType !== 'admin_jwt' || auth.mfa_verified !== true || !auth.email) {
      return res.status(403).json({ error: 'HUMAN_MFA_SESSION_REQUIRED', message: 'Une décision demande une session administrateur nominative avec MFA.' });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await decide(b.id, b.decision, b.note, String(auth.email), undefined, { sourceUrl: typeof b.sourceUrl === 'string' ? b.sourceUrl : '', territoryConfirmed: b.territoryConfirmed === true });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    const cache = await bumpContentEpoch();
    logger.info({ decision: String(b.decision || '').toUpperCase() }, '[StructureProposal] decided');
    return res.status(200).json({ ok: true, proposal: out.proposal, searchCacheCleared: cache.bumped, cdnRecordMaxAgeSeconds: 60, cdnListMaxAgeSeconds: 3600 })   // PKG-11 audit: only the search cache is cleared; the CDN copies expire on their own;
  } catch (error) {
    logger.error({ err: { name: error?.name, message: String(error?.message || '').slice(0, 200) } }, '[StructureProposal] failed');
    return res.status(500).json({ error: 'REVIEW_FAILED' });
  }
}
