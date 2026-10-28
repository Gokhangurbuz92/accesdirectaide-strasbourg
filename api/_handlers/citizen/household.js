// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { addHouseholdMember, removeHouseholdMember, getAccount } from '../../_services/citizen-account.js';

/** GET /api/citizen/household -> { household }   POST /api/citizen/household { relation, ageBand?, label? }   DELETE /api/citizen/household { id } */
export default citizenHandler('household', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  if (req.method === 'GET') return { ok: true, status: 200, household: (await getAccount(citizen.id)).household };
  if (req.method === 'POST') return addHouseholdMember(citizen.id, req.body);
  return removeHouseholdMember(citizen.id, req.body?.id);
});
