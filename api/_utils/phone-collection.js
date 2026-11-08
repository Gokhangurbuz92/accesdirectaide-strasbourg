/**
 * Release B / D2 V2 (owner decision 08/11/2026): the citizen telephone number is NOT collected until a specific, necessary purpose and a lawful basis are
 * established (no SMS, no appointment contact is open). Fail-closed, like the sensitivity review:
 *   - Production, Preview and the restricted beta: collection CLOSED, unless ADA_CITIZEN_PHONE_COLLECTION=open (exact value) — a later, separate decision;
 *   - development / test without the beta (the LAB runs the full product): open.
 * Closed means: the sign-up ignores a phone field, PUT /api/citizen/phone refuses a new number (removing a number already stored stays possible: art. 17),
 * and the settings screen does not offer the field. Nothing else of the account changes.
 */
import { isPublicBetaRestricted } from './public-beta.js';

export const PHONE_COLLECTION_CLOSED = Object.freeze({
  error: 'PHONE_COLLECTION_CLOSED',
  code: 'PHONE_COLLECTION_CLOSED',
  message: 'Le numéro de téléphone n’est pas demandé pour le moment : aucune fonction du service n’en a besoin.',
});

/** @param {Record<string, string | undefined>} [env] */
export function phoneCollectionOpen(env = process.env) {
  if (String(env.ADA_CITIZEN_PHONE_COLLECTION ?? '').trim().toLowerCase() === 'open') return true;
  const vercel = String(env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (vercel === 'production' || vercel === 'preview') return false;
  return !isPublicBetaRestricted(env);
}
