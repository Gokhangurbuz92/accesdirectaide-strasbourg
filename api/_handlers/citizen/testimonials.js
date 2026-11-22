// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { citizenTestimonials } from '../../_services/testimonials.js';
import { db as defaultDb } from '../../../src/db/index.js';
import { requireFeatureStaffed, suspensionRefusal } from '../../_services/moderation-dsa.js';

/**
 * X02 (expansion) — the person's testimonials (api/_services/testimonials.js). A verified citizen session (cookie), CSRF on writes, the capability
 * « community.testimonials » (closed by default), an ADULT account to submit. The person's own rows only.
 *   GET  /api/citizen/testimonials                                                            → { available, canSubmit, consentVersion, testimonials }
 *   POST /api/citizen/testimonials { action: 'submit', displayName, body, lang, consent: true, consentVersion }   (moderated before publication)
 *   POST /api/citizen/testimonials { action: 'withdraw', id }      at any time: out of public view at once, text and name erased, withdrawal recorded
 *   POST /api/citizen/testimonials { action: 'report', id, reason } a published testimonial, one reason from a closed list (account needed, limited)
 */
const ID = /^[0-9a-f-]{36}$/i;
export default citizenHandler('testimonials', ['GET', 'POST'], async (citizen, req) => {
  const svc = citizenTestimonials();
  if (req.method === 'GET') return svc.mine(citizen.id);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // G14: a new testimonial needs a named moderator to read it (fail closed) and an account whose publishing is not suspended (DSA art. 23)
  if (b.action === 'submit') return (await requireFeatureStaffed(defaultDb, 'testimonials')) || (await suspensionRefusal(defaultDb, citizen.id, 'publishing')) || svc.submit(citizen, b);
  const id = typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
  if (!id) return { ok: false, status: 400, code: 'ID_REQUIRED', message: 'Témoignage manquant.' };
  if (b.action === 'withdraw') return svc.withdraw(citizen.id, id);
  if (b.action === 'report') return (await suspensionRefusal(defaultDb, citizen.id, 'notices')) || svc.report(citizen.id, id, b.reason);
  return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
});
