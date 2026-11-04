/**
 * R42-BOOK × R42-A07 — the age gate of every appointment write (request, booking, reschedule): the account must be an ADULT account in the sense of the
 * single entry point api/_utils/age-policy.js isAdultAccount() (owned by R42-AUTH: verified e-mail, latest AGE_DECLARATION_ADULT statement « 18 or over »
 * in the append-only ConsentLog, profile age band not « moins-de-18 »; fail closed, never throws).
 * Two answers so the interface can send the person to the right step, without revealing anything about anyone else:
 *   409 AGE_DECLARATION_REQUIRED  no statement yet (accounts created before R42): declare it (POST /api/citizen/age-declaration { adult: true })
 *   403 ADULT_ACCOUNT_REQUIRED    stated under 18 (or the profile says so): no online appointment until a minor / guardian workflow exists
 */
import { isAdultAccount, latestAgeDeclaration } from './age-policy.js';

/**
 * @param {string} userId the signed-in citizen
 * @returns {Promise<null | { status: number, body: { error: string, code: string, message: string } }>}
 */
export async function bookingAgeRefusal(userId) {
  if (await isAdultAccount(userId)) return null;
  let declared = null;
  try { declared = await latestAgeDeclaration(userId); } catch { declared = false; }
  if (declared === null) {
    return { status: 409, body: { error: 'AGE_DECLARATION_REQUIRED', code: 'AGE_DECLARATION_REQUIRED',
      message: 'Avant de demander un rendez-vous, confirmez dans votre compte que vous avez 18 ans ou plus.' } };
  }
  return { status: 403, body: { error: 'ADULT_ACCOUNT_REQUIRED', code: 'ADULT_ACCOUNT_REQUIRED',
    message: 'La prise de rendez-vous en ligne est réservée aux personnes de 18 ans ou plus. Une personne mineure peut contacter directement la structure, avec un représentant légal si besoin.' } };
}
