import { citizenHandler } from '../../_utils/citizen-handler.js';
import { isAdultAccount, latestAgeDeclaration, recordAgeDeclaration } from '../../_utils/age-policy.js';

/**
 * R42-A07 — the age statement of a signed-in citizen account (accounts created before R42 have none and are not adult accounts until they make it).
 * GET  /api/citizen/age-declaration -> { adult: boolean, declared: boolean }
 * POST /api/citizen/age-declaration { adult: true | false } -> { adult, declared: true }   (only booleans; the statement is appended to the ledger)
 * No date of birth is asked or stored. A declaration is not a verification.
 */
export default citizenHandler('age-declaration', ['GET', 'POST'], async (/** @type {{ id: string }} */ citizen, /** @type {{ method?: string, body?: unknown }} */ req) => {
  if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? /** @type {Record<string, unknown>} */ (req.body) : {};
    if (typeof body.adult !== 'boolean') return { ok: false, status: 400, code: 'INVALID_AGE_DECLARATION', message: 'Indiquez si vous avez 18 ans ou plus (oui ou non).' };
    await recordAgeDeclaration(citizen.id, { adult: body.adult, channel: 'account' });
  }
  const declared = (await latestAgeDeclaration(citizen.id)) !== null;
  return { ok: true, status: 200, adult: await isAdultAccount(citizen), declared };
});
