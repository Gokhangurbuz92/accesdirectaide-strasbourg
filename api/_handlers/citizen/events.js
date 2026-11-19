// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { eventRegistrations } from '../../_services/academy-events.js';

/**
 * X04 (expansion) — the person's event registrations (api/_services/academy-events.js). A verified citizen session (cookie), CSRF on writes, the
 * capability « community.events » (closed by default), an ADULT account for a registration (age-policy.js). The person's own rows only.
 *   GET  /api/citizen/events                                                                  → { available, registrations }
 *   POST /api/citizen/events { action: 'register', itemId | slug, accessibilityNeed?, accessibilityNeedConsent? }   (a need travels only with consent === true)
 *   POST /api/citizen/events { action: 'cancel', itemId }                                    (the need is erased with the registration)
 *   POST /api/citizen/events { action: 'need', itemId, accessibilityNeed: <need> | null, accessibilityNeedConsent? }
 */
export default citizenHandler('events', ['GET', 'POST'], async (citizen, req) => {
  const svc = eventRegistrations();
  if (req.method === 'GET') return svc.mine(citizen.id);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const itemId = typeof b.itemId === 'string' && /^[0-9a-f-]{36}$/i.test(b.itemId) ? b.itemId : null;
  const slug = typeof b.slug === 'string' && /^[a-z0-9-]{3,90}$/.test(b.slug) ? b.slug : null;
  if (b.action === 'register' && (itemId || slug)) {
    return svc.register(citizen.id, { ...(itemId ? { itemId } : { slug }), accessibilityNeed: b.accessibilityNeed, accessibilityNeedConsent: b.accessibilityNeedConsent });
  }
  if (!itemId) return { ok: false, status: 400, code: 'ITEM_ID_REQUIRED', message: 'Événement manquant.' };
  if (b.action === 'cancel') return svc.cancel(citizen.id, itemId);
  if (b.action === 'need') return svc.setNeed(citizen.id, itemId, b.accessibilityNeed, b.accessibilityNeedConsent);
  return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
});
