// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { listOrganizations, setActivity } from '../../_services/org-lifecycle.js';
import { administerProAccount, listMembers } from '../../_services/pro-account-admin.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/**
 * PKG-5 / E01 — organization lifecycle (api/_services/org-lifecycle.js).
 *   GET  /api/admin/organizations?q=                 identity / activity / public / capacity, kept apart (any administrator session)
 *   POST /api/admin/organizations { id, action: SUSPEND|REACTIVATE, reason }   named administrator session WITH MFA
 *   GET  /api/admin/organizations?members=<structureId>                         G8: the organization's ADA Pro accounts (no secret, no hash; any administrator session)
 *   POST /api/admin/organizations { userId, action: DISABLE_PRO_ACCOUNT|ERASE_PRO_ACCOUNT, reason }   G8: one professional account (api/_services/pro-account-admin.js), MFA
 * Identity verification itself is the existing MFA content-verification flow (/api/admin/content-verification, entityType structure).
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await resolveAuthContext(req);
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET' && req.query?.members !== undefined) return res.status(200).json(await listMembers(String(req.query.members || '')));
    if (req.method === 'GET') return res.status(200).json(await listOrganizations({ q: String(req.query?.q || ''), decision: String(req.query?.decision || '') }));
    if (auth.authType !== 'admin_jwt' || auth.mfa_verified !== true || !auth.email) return res.status(403).json({ error: 'HUMAN_MFA_SESSION_REQUIRED', message: 'Requires a named administrator session with MFA.' });
    const action = String(req.body?.action || '').toUpperCase();
    if (action === 'DISABLE_PRO_ACCOUNT' || action === 'ERASE_PRO_ACCOUNT') {
      const acc = await administerProAccount(action, req.body || {}, String(auth.email));
      if (!acc.ok) return res.status(acc.status).json({ error: acc.code, message: acc.message, ...(acc.holds ? { holds: acc.holds } : {}) });
      return res.status(200).json(acc);
    }
    const out = await setActivity(req.body?.id, req.body || {}, String(auth.email));
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    await bumpContentEpoch().catch(() => {});
    return res.status(200).json(out);
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Organizations] failed');
    return res.status(500).json({ error: 'ORGANIZATION_ACTION_FAILED' });
  }
}
