import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { liftSuppression, suppressionReason } from '../../_services/mail-events.js';

/**
 * R44-MAIL — the explicit, authorized lift of an e-mail suppression (R43 security review: a forged or mistaken bounce had no way back).
 *   POST /api/admin/mail-suppressions { action: 'status', email }           → { suppressed: reason | null }
 *   POST /api/admin/mail-suppressions { action: 'lift', email, reason }     → { lifted, previous }
 * Behind the K5 administrator gate as a PLATFORM operation (api/_utils/admin-gate.js `elevated`): a named administrator session with MFA AND an unexpired
 * JIT / break-glass elevation. The reason (10–500 characters) is required and audited (« mail.suppression_lifted », entity_id = HMAC of the address, with
 * the administrator); the gate also writes its ADMIN_API_WRITE row. The address travels only in the POST body (never in a URL), is only hashed, and is
 * never stored, logged or answered. Rate-limited like every administrator API. Why an API and not a script: a script would need the Production database
 * URL on a laptop; this path reuses the existing MFA, elevation and audit of the administrator surface and needs no new secret.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(429).json(rate.error);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const auth = await adminGate(req, res, { write: true, elevated: true }); if (!auth) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email : '';
  try {
    if (body.action === 'status') {
      return res.status(200).json({ suppressed: await suppressionReason(email) });
    }
    if (body.action !== 'lift') return res.status(400).json({ error: 'invalid_action', message: 'action : « status » ou « lift ».' });
    const out = await liftSuppression(email, { reason: typeof body.reason === 'string' ? body.reason : '', by: String(auth.email) });
    if (!out.ok) {
      const message = out.code === 'reason_required' ? 'Indiquez la raison de la levée (10 à 500 caractères).'
        : out.code === 'invalid_address' ? 'Adresse e-mail invalide.' : 'Clé serveur absente : aucune suppression ne peut exister ni être levée.';
      return res.status(out.code === 'no_key' ? 503 : 400).json({ error: out.code, message });
    }
    logger.info({ msg: 'mail_suppression.lift', lifted: out.lifted, previous: out.previous }, '[mail-suppressions] lift requested');
    return res.status(200).json({ lifted: out.lifted, previous: out.previous });
  } catch (error) {
    logger.error({ msg: 'mail_suppression.failed', err: { name: error instanceof Error ? error.name : 'Error' } }, '[mail-suppressions] failed');
    return res.status(500).json({ error: 'MAIL_SUPPRESSIONS_FAILED' });
  }
}
