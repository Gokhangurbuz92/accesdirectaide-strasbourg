// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { citizenStories } from '../../_services/community-stories.js';
import { db as defaultDb } from '../../../src/db/index.js';
import { requireFeatureStaffed, suspensionRefusal } from '../../_services/moderation-dsa.js';

/**
 * X01 (expansion) — the person's community pseudonym and stories (api/_services/community-stories.js). A verified citizen session (cookie), CSRF on writes,
 * the per-account write rate limit, the capability « community.stories » (closed by default), an ADULT account to join and to post. The person's own rows only.
 *   GET  /api/citizen/stories                                                     → { available, member, canSubmit, consentVersion, limits, stories }
 *   POST /api/citizen/stories { action: 'join', pseudonym }                        the pseudonymous principal (chosen, never prefilled, immutable)
 *   POST /api/citizen/stories { action: 'leave' }                                  every active story withdrawn and erased, the pseudonym deleted
 *   POST /api/citizen/stories { action: 'submit', title, body, lang, consent: true, consentVersion }   moderated before publication
 *   POST /api/citizen/stories { action: 'withdraw', id }                           at any time: out of public view at once, title and text erased
 *   POST /api/citizen/stories { action: 'report', id, reason }                     a published story, one reason from a closed list (limited)
 */
const ID = /^[0-9a-f-]{36}$/i;
export default citizenHandler('stories', ['GET', 'POST'], async (citizen, req) => {
  const svc = citizenStories();
  if (req.method === 'GET') return svc.mine(citizen.id);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.action === 'join') return svc.join(citizen, b);
  if (b.action === 'leave') return svc.leave(citizen.id);
  // G14: a new story needs a named moderator to read it (fail closed) and an account whose publishing is not suspended (DSA art. 23)
  if (b.action === 'submit') return (await requireFeatureStaffed(defaultDb, 'stories')) || (await suspensionRefusal(defaultDb, citizen.id, 'publishing')) || svc.submit(citizen, b);
  const id = typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
  if (!id) return { ok: false, status: 400, code: 'ID_REQUIRED', message: 'Histoire manquante.' };
  if (b.action === 'withdraw') return svc.withdraw(citizen.id, id);
  if (b.action === 'report') return (await suspensionRefusal(defaultDb, citizen.id, 'notices')) || svc.report(citizen.id, id, b.reason);
  return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
});
