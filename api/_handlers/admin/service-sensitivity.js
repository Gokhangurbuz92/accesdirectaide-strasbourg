import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { listForReview, reviewServiceSensitivity } from '../../_services/service-sensitivity-review.js';
import { sensitiveBookingOpen, sensitivityReviewEnforced } from '../../lib/service-sensitivity.js';

/**
 * R45 (ENG-LR-2) — the administrator review of the sensitivity of a structure's bookable services (GDPR art. 9, D2 P5s [PROPOSITION]).
 *   POST /api/admin/service-sensitivity { action: 'list', structureId }                               → services, verified value, who/when, SUGGESTION
 *   POST /api/admin/service-sensitivity { action: 'review', structureId, serviceId, value, reason }    → { previous, value, reviewedAt }
 * value: 'sensitive' | 'ordinary' | 'unknown' (back to not reviewed). The reason (10–500 characters, plain text) is required.
 * Behind the K5 administrator gate as a PLATFORM operation, like the R44 suppression lift (api/_utils/admin-gate.js `elevated`): a named administrator
 * session with MFA AND an unexpired JIT / break-glass elevation; the gate writes its ADMIN_API_WRITE row and the service its « service.sensitivity_reviewed »
 * row (identifiers and values only). Citizens, professionals, structures and institutions are refused. The heuristic suggestion never sets a value.
 * Every body travels in the POST (nothing in a URL). Rate-limited like every administrator API.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(429).json(rate.error);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const auth = await adminGate(req, res, { write: true, elevated: true }); if (!auth) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    if (body.action === 'list') {
      const out = typeof body.structureId === 'string' ? await listForReview(body.structureId) : null;
      if (!out) return res.status(404).json({ error: 'structure_not_found' });
      return res.status(200).json({ ...out, gate: { sensitiveBookingOpen: sensitiveBookingOpen(), reviewEnforced: sensitivityReviewEnforced() } });
    }
    if (body.action !== 'review') return res.status(400).json({ error: 'invalid_action', message: 'action : « list » ou « review ».' });
    const out = await reviewServiceSensitivity({ structureId: body.structureId, serviceId: body.serviceId, value: body.value, reason: body.reason, by: String(auth.email || '') });
    if (!out.ok) {
      const message = out.code === 'reason_required' ? 'Indiquez la raison de la classification (10 à 500 caractères, texte simple).'
        : out.code === 'invalid_value' ? 'Valeur : « sensitive », « ordinary » ou « unknown ».'
          : out.code === 'service_not_found' ? 'Service introuvable pour cette structure.' : 'Requête invalide.';
      return res.status(out.status).json({ error: out.code, message });
    }
    logger.info({ msg: 'service_sensitivity.reviewed', previous: out.previous, value: out.value }, '[service-sensitivity] reviewed');
    return res.status(200).json(out);
  } catch (error) {
    logger.error({ msg: 'service_sensitivity.failed', err: { name: error instanceof Error ? error.name : 'Error' } }, '[service-sensitivity] failed');
    return res.status(500).json({ error: 'SERVICE_SENSITIVITY_FAILED' });
  }
}
