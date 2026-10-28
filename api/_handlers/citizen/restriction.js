// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { liftBySubject, requestRestriction, restrictionState } from '../../_services/processing-restriction.js';

/**
 * PKG-11 / C21 — restriction of processing (RGPD art. 18), the person's own session (api/_services/processing-restriction.js).
 *   GET  /api/citizen/restriction                                  current state and the four grounds
 *   POST /api/citizen/restriction { action: 'request', ground }     applies at once
 *   POST /api/citizen/restriction { action: 'lift' }                the person lifts it
 */
export default citizenHandler('restriction', ['GET', 'POST'], async (citizen, req) => {
  if (req.method === 'GET') return restrictionState(citizen.id);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.action === 'request') return requestRestriction(citizen.id, b);
  if (b.action === 'lift') return liftBySubject(citizen.id);
  return { ok: false, status: 400, code: 'invalid_action', message: 'Action invalide.' };
});
