// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { getAccount, saveProfile } from '../../_services/citizen-account.js';

/** GET /api/citizen/profile -> { account: { profile, household, preferences, agePolicy } } (the same shape PUT returns)   PUT /api/citizen/profile { displayName?, preferredLanguage?, ageBand?, departement?, accessibilityPrefs?, prefillConsent? } */
export default citizenHandler('profile', ['GET', 'PUT'], async (citizen, req) => {
  if (req.method === 'GET') return { ok: true, status: 200, account: await getAccount(citizen.id) };
  return saveProfile(citizen.id, req.body);
});
