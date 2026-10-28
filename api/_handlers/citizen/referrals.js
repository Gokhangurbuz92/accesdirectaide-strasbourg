// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { citizenDecide, citizenList } from '../../_services/referrals.js';

/** PKG-4 / R09 — the person's referrals.  GET -> { referrals }   POST { id, decision: 'accept' | 'refuse' } (only the dossier's owner; nothing is shared before 'accept'). */
export default citizenHandler('referrals', ['GET', 'POST'], async (citizen, req) => {
  if (req.method === 'GET') return citizenList(citizen.id);
  const d = String(req.body?.decision || '');
  if (!['accept', 'refuse'].includes(d)) return { ok: false, status: 400, code: 'INVALID_DECISION', message: 'Répondez par accepter ou refuser.' };
  return citizenDecide(citizen.id, req.body?.id, d === 'accept');
});
