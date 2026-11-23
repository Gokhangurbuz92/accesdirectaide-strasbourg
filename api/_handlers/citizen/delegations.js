// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { sendMail } from '../../_utils/mailer.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { delegateView, delegationAccessLog, endDelegation, inviteDelegate, listDelegations, respondInvitation } from '../../_services/delegation.js';
import { ACT_SCOPES, ACTION_TYPES, actForMeMap, actionEventsOf, actionsOpen, delegateRequests, listRequests, requestAction, resolveRequest, setActForMe } from '../../_services/delegation-actions.js';

/**
 * PKG-2 / C23.  GET -> { granted, received }   GET ?log=<id> -> { events } (principal)   GET ?id=<id>&view=parcours|coffre|rdv -> read-only projection (delegate, logged)
 * POST { action: 'invite', email, role, scopes, days } | { action: 'respond', token, accept } | { action: 'end', id }
 * G14-AID (mode accompagnant à distance, api/_services/delegation-actions.js; also needs citizen.assisted_mode — otherwise `actions: { open: false }` and 404):
 *   GET           -> also { actions: { open, types, actScopes, actForMe: { [id]: { RDV_READ, PARCOURS_READ } } }, requests: [...] }  (the person's pending requests)
 *   GET ?log=<id> -> also { actionEvents: [{ at, event, type, target }] }                          GET ?requests=<id> -> { requests } (the trusted person's own)
 *   POST { action: 'request-action', id, type: 'RDV_CANCEL', appointmentId } | { action: 'request-action', id, type: 'PARCOURS_STATUS', itemId, status }   (trusted person)
 *   POST { action: 'resolve-request', requestId, accept }   POST { action: 'act-for-me', id, scope, on, password? }   (the person)
 */
export default citizenHandler('delegations', ['GET', 'POST'], async (citizen, req, res) => {
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q.log) {
      const out = await delegationAccessLog(citizen.id, q.log);
      return out.ok && actionsOpen() ? { ...out, actionEvents: await actionEventsOf(citizen.id, q.log) } : out;
    }
    if (q.view) return delegateView(citizen.id, q.id, q.view);
    if (q.requests) return actionsOpen() ? delegateRequests(citizen.id, q.requests) : { ok: true, status: 200, requests: [] };
    const out = await listDelegations(citizen.id);
    if (!actionsOpen()) return { ...out, actions: { open: false } };
    return { ...out, actions: { open: true, types: Object.keys(ACTION_TYPES), actScopes: ACT_SCOPES, actForMe: await actForMeMap(citizen.id, out.granted.map((d) => d.id)) }, requests: await listRequests(citizen.id) };
  }
  const body = req.body || {};
  if (body.action === 'invite') return inviteDelegate(citizen, body, { sendMail, buildUrl: buildAppUrl });
  if (body.action === 'respond') return respondInvitation(citizen, body);
  if (body.action === 'end') return endDelegation(citizen.id, body.id);
  if (body.action === 'request-action') return requestAction(citizen, body);
  if (body.action === 'resolve-request') return resolveRequest(citizen, body);
  if (body.action === 'act-for-me') {
    if (body.on === true) {
      const limit = await checkRateLimit('ASSIST_REAUTH', citizen.id);
      if (!limit.allowed) { res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' }); return undefined; }
    }
    return setActForMe(citizen, body);
  }
  return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
});
