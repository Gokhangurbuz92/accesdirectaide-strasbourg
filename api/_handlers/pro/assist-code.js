// @ts-nocheck
import logger from '../../_utils/logger.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { withProRateLimit } from '../../_utils/pro-rate-limit.js';
import { issueProHelperCode } from '../../_services/assisted-mode.js';

/**
 * G14-AID — GET /api/pro/assist-code -> { code, validUntil, structureName }: the one-time helper code a professional shows to the person they help, who types it
 * in the « mode accompagnant » consent screen (api/_services/assisted-mode.js). Only an ACTIVE member with the second factor enrolled and passed in THIS session
 * (whatever PRO_MFA_REQUIRED says); valid 10 to 20 minutes; nothing is stored but an audit line (no citizen is named). Capabilities pro.account +
 * citizen.assisted_mode.
 */
async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  try {
    const out = await issueProHelperCode({ userId: ctx.userId, structureId: ctx.structureId, mfa: req.user?.mfa === true });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    const body = Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'ok' && k !== 'status'));
    return res.status(out.status).json(body);
  } catch (err) {
    logger.error({ err: { name: err?.name } }, '[pro/assist-code] failed');
    return res.status(500).json({ error: 'internal_error' });
  }
}

export default requireProAuth(withProRateLimit('pro.assist_code', handler));
