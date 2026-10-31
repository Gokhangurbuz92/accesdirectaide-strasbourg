// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { db } from '../../../src/db/index.js';
import { GuardianRelationship, CitizenUser, CitizenProfile } from '../../../src/db/schema.js';
import { appendConsent } from '../../_services/citizen-account.js';
import { declareGuardian, listGuardianships, confirmAsGuardian, requestStrongVerification, revokeGuardianship, drizzleGuardianStore } from '../../_services/guardianship.js';

/**
 * C05 — GET /api/citizen/guardians → { guardianships, policy }
 * POST /api/citizen/guardians { action: 'declare', guardianEmail } | { action: 'confirm' | 'request-strong' | 'revoke', id }
 * (closed in the public beta like every account route; the strong check is recorded by a verifier, never by the two people themselves)
 */
export default citizenHandler('guardians', ['GET', 'POST'], async (citizen, req) => {
  const store = drizzleGuardianStore(db, { GuardianRelationship, CitizenUser, CitizenProfile }, appendConsent);
  if (req.method === 'GET') return listGuardianships(citizen.id, store);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.action === 'declare') return declareGuardian(citizen.id, b, store);
  if (b.action === 'confirm') return confirmAsGuardian(citizen.id, b.id, store);
  if (b.action === 'request-strong') return requestStrongVerification(citizen.id, b.id, store);
  if (b.action === 'revoke') return revokeGuardianship(citizen.id, b.id, store);
  return { ok: false, status: 400, code: 'UNKNOWN_ACTION', message: 'Action inconnue.' };
});
