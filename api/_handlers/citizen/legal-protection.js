// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { contestMandate, declareMandate, issueHelperCode, listMine, mandateHistory, renounceMandate, representativeAct, representativeView, resolveRequest } from '../../_services/legal-protection.js';

/**
 * G14-R3G — « Protection juridique » (/compte/protection-juridique): the representative of a protected adult (tutelle, curatelle, habilitation familiale,
 * mandat spécial; a relative or an MJPM) and the protected person, each from their OWN account (api/_services/legal-protection.js).
 *   GET                         -> { installed, asPerson, asRepresentative, requests, limits }
 *   GET ?log=<id>               -> { events }   (either side of that link)
 *   GET ?id=<id>&view=rdv|parcours -> read-only projection for a VERIFIED representative, logged for the person
 *   POST { action: 'declare', personEmail, measure, mode?, representativeKind, mjpmForm?, siret?, scopePerson, scopeAssets, courtName, decisionDate,
 *          measureEndsOn?, decisionRef?, truthful: true, password }                                     (the representative; neutral answer, 202)
 *   POST { action: 'contest', id }          (the person: a verified link is suspended at once, the administrator reviews)
 *   POST { action: 'renounce', id }         (the representative)
 *   POST { action: 'act', id, type: 'RDV_CANCEL' | 'PARCOURS_STATUS', appointmentId? | itemId?, status? }   (ACT: done; CONFIRM: a request to the person)
 *   POST { action: 'resolve-request', requestId, accept }                                            (the person)
 *   POST { action: 'helper-code', id }      (the representative: the code for the person's « mode accompagnant »)
 * Capability citizen.legal_protection (refused 503 before this handler while closed).
 */
export default citizenHandler('legal-protection', ['GET', 'POST'], async (citizen, req, res) => {
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q.log) return mandateHistory(citizen.id, q.log);
    if (q.view) return representativeView(citizen, q.id, String(q.view));
    return listMine(citizen.id);
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.action === 'declare') {
    // a password is checked: the same re-authentication limit as the other password confirmations of the account
    const limit = await checkRateLimit('ASSIST_REAUTH', citizen.id);
    if (!limit.allowed) { res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' }); return undefined; }
    return declareMandate(citizen, body);
  }
  if (body.action === 'contest') return contestMandate(citizen, body.id);
  if (body.action === 'renounce') return renounceMandate(citizen, body.id);
  if (body.action === 'act') return representativeAct(citizen, body);
  if (body.action === 'resolve-request') return resolveRequest(citizen, body);
  if (body.action === 'helper-code') return issueHelperCode(citizen, body.id);
  return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
});
