/**
 * R47 — GET / POST /api/pro/appointments/reschedule: the structure moves one of its appointments (rules: api/_services/rdv-pro-reschedule.js).
 * Professional session (MFA where required), tenant-scoped rate limit (withProRdvHandler), CSRF at the API entry.
 */
import { requireProStructureContext } from '../../../_utils/auth.js';
import { clientIp } from '../../../_utils/client-ip.js';
import { withProRdvHandler } from '../../../_utils/with-pro-rdv-handler.js';
import { moveOptions, proReschedule } from '../../../_services/rdv-pro-reschedule.js';

/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const out = await moveOptions(proCtx, { id: String(req.query?.id || '').trim(), from: req.query?.from });
    return res.status(out.status).json(out.body);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? /** @type {Record<string, unknown>} */ (req.body) : {};
  const out = await proReschedule(proCtx, { id: String(body.id || '').trim(), startAt: body.startAt, expectedStartAt: body.expectedStartAt, sensitiveConsent: body.sensitiveConsent, ip: clientIp(req) });
  return res.status(out.status).json(out.body);
}

export default withProRdvHandler('pro.appointments.reschedule', handler);
