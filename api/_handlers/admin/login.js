// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { adminLogin } from '../../_services/admin-identity.js';

/** PKG-5 / A16 — POST /api/admin/login: the administrator login surface, separate from citizen and professional login. Returns a session WITHOUT MFA; the client then
 * completes MFA (POST /api/admin/mfa-verify) or sets it up (POST /api/admin/mfa-setup). Nothing about the account is revealed on failure. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = await checkRateLimit('LOGIN_USER', `admin:${getClientIp(req)}`);
  if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many attempts' });
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await adminLogin({ email: b.email, password: b.password });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    return res.status(200).json({ success: true, token: out.token, user: out.user, mfa_required: out.mfa_required, mfa_setup_required: out.mfa_setup_required, readOnly: out.readOnly === true });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[AdminLogin] failed');
    return res.status(500).json({ error: 'LOGIN_FAILED' });
  }
}
