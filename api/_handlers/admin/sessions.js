// @ts-nocheck
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole, isElevated } from '../../_utils/auth.js';
import { actOnAdministrator, logoutAll, sessionOverview } from '../../_services/admin-identity.js';

/**
 * PKG-11 / ADM-10 — administrator sessions.
 *   GET                                                  -> the administrators (no secret) and the recent session events (named admin session)
 *   POST { action: 'logout' }                            -> end every session of mine (this one included)
 *   POST { action: 'revoke' | 'disable' | 'enable', email, reason } -> on ANOTHER administrator: elevated superadmin only, audited
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = await resolveAuthContext(req);
  if (!auth || auth.authType !== 'admin_jwt' || !isAdminRole(auth.role)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') return res.status(200).json(await sessionOverview());
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = b.action === 'logout' ? await logoutAll(auth)
      : await actOnAdministrator(auth, { action: b.action, email: b.email, reason: b.reason }, { elevated: isElevated(auth) && String(auth.role).toUpperCase() === 'SUPERADMIN' });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    return res.status(200).json(out);
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AdminSessions] failed');
    return res.status(500).json({ error: 'ADMIN_SESSIONS_FAILED' });
  }
}
