// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { citizenEntraide } from '../../_services/entraide.js';

/**
 * X03 (expansion) — ENTRAIDE, the member side (api/_services/entraide.js). ⚠ A DEDICATED AIPD IS MANDATORY BEFORE ANY OPENING (capability
 * « community.entraide », closed by default, surface « entraide » opened by nothing). A verified citizen session (cookie), CSRF on writes, the per-account
 * write rate limit, an ADULT account, the current charter. The person's own rows only; no messaging route exists.
 *   GET  /api/citizen/entraide                                         → { available, member, offers, sent, received, blocks, charterVersion, contactVersion, limits }
 *   GET  /api/citizen/entraide?view=browse&category=…&area=…           → { items: anonymous open offers (category, area, note, day) } — no volunteer, no score
 *   POST { action: 'join', pseudonym, charter: true, charterVersion }   the pseudonymous principal + the charter (ConsentLog)
 *   POST { action: 'accept_charter', charter: true, charterVersion }    a new version of the charter
 *   POST { action: 'leave' }                                           everything erased (offers, requests, e-mails, reports, blocks)
 *   POST { action: 'offer_create', category, area, note? } | { action: 'offer_pause' | 'offer_reopen' | 'offer_close', id }
 *   POST { action: 'request_create', offerId, note? }                   first half of the double opt-in
 *   POST { action: 'request_accept' | 'request_decline', id }           the volunteer — accepting reveals both pseudonyms
 *   POST { action: 'request_end', id }                                  withdraw a pending request (requester) or end an accepted one (either side)
 *   POST { action: 'contact_share', requestId, email, consent: true, consentVersion } | { action: 'contact_revoke', requestId }   after mutual acceptance only
 *   POST { action: 'report', offerId | requestId, reason } | { action: 'block', offerId | requestId } | { action: 'unblock', id }
 */
const ID = /^[0-9a-f-]{36}$/i;
const id = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
const MISSING = { ok: false, status: 400, code: 'ID_REQUIRED', message: 'Élément manquant.' };
export default citizenHandler('entraide', ['GET', 'POST'], async (citizen, req) => {
  const svc = citizenEntraide();
  if (req.method === 'GET') return req.query?.view === 'browse' ? svc.browse(citizen.id, req.query) : svc.mine(citizen.id);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  switch (b.action) {
    case 'join': return svc.join(citizen, b);
    case 'accept_charter': return svc.acceptCharter(citizen, b);
    case 'leave': return svc.leave(citizen.id);
    case 'offer_create': return svc.offerCreate(citizen, b);
    case 'request_create': return id(b.offerId) ? svc.requestCreate(citizen, b) : MISSING;
    case 'contact_share': return id(b.requestId) ? svc.contactShare(citizen, b) : MISSING;
    case 'contact_revoke': return id(b.requestId) ? svc.contactRevoke(citizen.id, b.requestId) : MISSING;
    case 'report': return id(b.offerId) || id(b.requestId) ? svc.report(citizen, { offerId: id(b.offerId), requestId: id(b.requestId), reason: b.reason }) : MISSING;
    case 'block': return id(b.offerId) || id(b.requestId) ? svc.block(citizen.id, { offerId: id(b.offerId), requestId: id(b.requestId) }) : MISSING;
    default: break;
  }
  const target = id(b.id);
  if (!target) return b.action ? MISSING : { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
  switch (b.action) {
    case 'offer_pause': return svc.offerStatus(citizen.id, target, 'paused');
    case 'offer_reopen': return svc.offerStatus(citizen.id, target, 'open');
    case 'offer_close': return svc.offerClose(citizen.id, target);
    case 'request_accept': return svc.requestDecide(citizen.id, target, true);
    case 'request_decline': return svc.requestDecide(citizen.id, target, false);
    case 'request_end': return svc.requestEnd(citizen.id, target);
    case 'unblock': return svc.unblock(citizen.id, target);
    default: return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
  }
});
