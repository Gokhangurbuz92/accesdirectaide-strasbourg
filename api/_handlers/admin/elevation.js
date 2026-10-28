// @ts-nocheck
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole, isElevated } from '../../_utils/auth.js';
import { elevate, endElevation, pendingBreakGlass, reviewBreakGlass } from '../../_services/admin-identity.js';

/**
 * PKG-5 / A16 — platform-operations elevation.
 *   GET  /api/admin/elevation                       -> current elevation state + break-glass uses awaiting review (named admin session)
 *   POST { action: 'elevate', code, reason }        -> 15-minute JIT elevation (superadmin, MFA session, fresh TOTP)
 *   POST { action: 'break_glass', code, reason }    -> 30-minute emergency elevation (any named MFA admin), reviewed afterwards by ANOTHER admin
 *   POST { action: 'review', id, note }             -> that review (two-person rule)
 *   POST { action: 'end' }                          -> drop the elevation now
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = await resolveAuthContext(req);
  if (!auth || auth.authType !== 'admin_jwt' || !isAdminRole(auth.role)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ elevated: isElevated(auth), kind: isElevated(auth) ? auth.elevationKind : null, until: isElevated(auth) ? new Date(auth.elevatedUntil * 1000).toISOString() : null,
        mfa: auth.mfa_verified === true, pendingBreakGlassReviews: await pendingBreakGlass() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let out;
    if (b.action === 'elevate') out = await elevate(auth, { code: b.code, reason: b.reason, kind: 'JIT' });
    else if (b.action === 'break_glass') out = await elevate(auth, { code: b.code, reason: b.reason, kind: 'BREAK_GLASS' });
    else if (b.action === 'review') out = await reviewBreakGlass(auth, { id: b.id, note: b.note });
    else if (b.action === 'end') out = await endElevation(auth);
    else return res.status(400).json({ error: 'unknown_action' });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    return res.status(200).json(out);
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AdminElevation] failed');
    return res.status(500).json({ error: 'ELEVATION_FAILED', message: 'L’élévation n’a pas pu être lue ou enregistrée. Réessayez.' });
  }
}
