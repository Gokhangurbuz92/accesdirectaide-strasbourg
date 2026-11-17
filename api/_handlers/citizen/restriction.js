// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { liftBySubject, requestRestriction, restrictionState } from '../../_services/processing-restriction.js';
import { objectionState, requestObjection } from '../../_services/processing-objection.js';

/**
 * PKG-11 / C21 — restriction of processing (RGPD art. 18), the person's own session (api/_services/processing-restriction.js).
 *   GET  /api/citizen/restriction                                  current state and the four grounds
 *   POST /api/citizen/restriction { action: 'request', ground }     applies at once
 *   POST /api/citizen/restriction { action: 'lift' }                the person lifts it
 * A-20 — objection (RGPD art. 21), same session and same route (api/_services/processing-objection.js): recorded, answered by a person, never applied automatically.
 *   GET  also returns `objection` (the latest: OPEN or ANSWERED, or null)
 *   POST /api/citizen/restriction { action: 'object', reason? }      files the request in the rights register and the privacy queue (201; 200 when one is already open)
 */
export default citizenHandler('restriction', ['GET', 'POST'], async (citizen, req) => {
  if (req.method === 'GET') return { ...(await restrictionState(citizen.id)), objection: await objectionState(citizen.id) };
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.action === 'request') return requestRestriction(citizen.id, b);
  if (b.action === 'lift') return liftBySubject(citizen.id);
  if (b.action === 'object') return requestObjection(citizen, b);
  return { ok: false, status: 400, code: 'invalid_action', message: 'Action invalide.' };
});
