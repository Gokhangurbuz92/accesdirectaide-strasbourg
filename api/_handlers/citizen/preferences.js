// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { getPreferences, setPreference } from '../../_services/citizen-account.js';

/** GET /api/citizen/preferences   PUT /api/citizen/preferences { channel, category, enabled, consentGiven? }  (SMS, push and every marketing option need consentGiven:true and are recorded in the consent ledger) */
export default citizenHandler('preferences', ['GET', 'PUT'], async (citizen, req) => {
  if (req.method === 'GET') return { ok: true, status: 200, preferences: await getPreferences(citizen.id) };
  return setPreference(citizen.id, req.body);
});
