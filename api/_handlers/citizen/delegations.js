// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { sendMail } from '../../_utils/mailer.js';
import { delegateView, delegationAccessLog, endDelegation, inviteDelegate, listDelegations, respondInvitation } from '../../_services/delegation.js';

/**
 * PKG-2 / C23.  GET -> { granted, received }   GET ?log=<id> -> { events } (principal)   GET ?id=<id>&view=parcours|coffre|rdv -> read-only projection (delegate, logged)
 * POST { action: 'invite', email, role, scopes, days } | { action: 'respond', token, accept } | { action: 'end', id }
 */
export default citizenHandler('delegations', ['GET', 'POST'], async (citizen, req) => {
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q.log) return delegationAccessLog(citizen.id, q.log);
    if (q.view) return delegateView(citizen.id, q.id, q.view);
    return listDelegations(citizen.id);
  }
  const body = req.body || {};
  if (body.action === 'invite') return inviteDelegate(citizen, body, { sendMail, buildUrl: buildAppUrl });
  if (body.action === 'respond') return respondInvitation(citizen, body);
  if (body.action === 'end') return endDelegation(citizen.id, body.id);
  return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
});
