import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';
import { NOT_AVAILABLE, listExternalBookings, reviewExternalBooking, submitExternalBooking } from '../../_services/external-booking.js';
import { externalBookingMode } from '../../lib/external-booking.js';

/**
 * G14 release 3 — the administrator review of the places' own booking pages (« Rendez-vous sur leur site »), like the other publication flows.
 *   POST /api/admin/external-booking { action: 'list', status }                                  → the queue (PENDING by default), the public switch state
 *   POST /api/admin/external-booking { action: 'review', structureId, decision, note }          → APPROVE | REJECT, note 10–500 characters (journaled)
 *   POST /api/admin/external-booking { action: 'set', structureId, url, subdomains? }           → records a page for a place (PENDING, source ADMIN)
 * Reading needs an administrator session; a write a named administrator session with MFA (api/_utils/admin-gate.js `write`). Approving shows nothing by
 * itself: the page is public only while ADA_EXTERNAL_BOOKING is open. Every body travels in the POST (nothing in a URL). Rate-limited.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(429).json(rate.error);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const body = /** @type {Record<string, any>} */ (req.body && typeof req.body === 'object' ? req.body : {});
  const write = body.action === 'review' || body.action === 'set';
  const auth = await adminGate(req, res, { write }); if (!auth) return;
  try {
    if (body.action === 'list') {
      const items = await listExternalBookings({ status: typeof body.status === 'string' ? body.status : 'PENDING' });
      if (!items) return res.status(NOT_AVAILABLE.status).json({ error: NOT_AVAILABLE.code, message: NOT_AVAILABLE.message });
      return res.status(200).json({ items, publicDisplay: externalBookingMode() });
    }
    if (body.action === 'review') {
      const out = await reviewExternalBooking({ structureId: body.structureId, decision: body.decision, note: body.note, by: String(auth.email || '') });
      if (!out.ok) {
        const message = out.code === 'NOTE_REQUIRED' ? 'Indiquez un motif (10 à 500 caractères, texte simple).' : out.code === 'NOT_FOUND' ? 'Aucune page de rendez-vous pour cette structure.'
          : out.code === 'URL_NO_LONGER_VALID' ? 'L’adresse ne respecte plus les règles : elle ne peut pas être approuvée.' : 'Requête invalide.';
        return res.status(out.status).json({ error: out.code, message });
      }
      await bumpContentEpoch().catch(() => {});
      logger.info({ msg: 'external_booking.reviewed', previous: out.previous, status: out.status }, '[external-booking] reviewed');
      return res.status(200).json(out);
    }
    if (body.action === 'set') {
      const out = await submitExternalBooking({ structureId: body.structureId, url: body.url, subdomains: body.subdomains, source: 'ADMIN', by: String(auth.email || '') });
      if (!out.ok) return res.status(out.status).json({ error: out.code });
      return res.status(200).json({ record: out.record, changed: out.changed });
    }
    return res.status(400).json({ error: 'invalid_action', message: 'action : « list », « review » ou « set ».' });
  } catch (error) {
    logger.error({ msg: 'external_booking.failed', err: { name: error instanceof Error ? error.name : 'Error' } }, '[external-booking] failed');
    return res.status(500).json({ error: 'EXTERNAL_BOOKING_FAILED' });
  }
}
