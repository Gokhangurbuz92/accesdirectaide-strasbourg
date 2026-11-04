/**
 * R42 (owner decision R42-A07) — the account-level age rule an appointment needs, shared by the booking stream (R42-BOOK) and the registration stream
 * (R42-AUTH). No appointment may be requested, held or booked for a minor account until a separate minor / guardian workflow exists.
 *
 * The attribute is the one that exists today: CitizenProfile.ageBand, a SELF-DECLARED age band of the closed vocabulary of api/lib/ageBands.js (never a
 * birth date, never an identity document — proportionate by design). Three outcomes:
 *   - ADULT       one of the adult bands ('18-24', '25-59', '60-et-plus')
 *   - MINOR       'moins-de-18'
 *   - UNDECLARED  no band (or an unknown value): nothing is inferred; the booking asks the person to declare their age band first (fail closed)
 * isAdultAccount() is true only for ADULT. The server is the authority: the booking API calls it on every request/hold/booking.
 */
import { eq } from 'drizzle-orm';
import { CitizenProfile } from '../../src/db/schema.js';
import { db as defaultDb } from '../../src/db/index.js';

/** the adult bands of api/lib/ageBands.js */
export const ADULT_AGE_BANDS = Object.freeze(['18-24', '25-59', '60-et-plus']);
export const MINOR_AGE_BAND = 'moins-de-18';

/** @typedef {'ADULT' | 'MINOR' | 'UNDECLARED'} AccountAge */

/** @param {{ ageBand?: string | null } | null | undefined} user @returns {AccountAge} */
export function accountAge(user) {
  const band = typeof user?.ageBand === 'string' ? user.ageBand : null;
  if (band === MINOR_AGE_BAND) return 'MINOR';
  if (band && ADULT_AGE_BANDS.includes(band)) return 'ADULT';
  return 'UNDECLARED';
}

/** true only when the account declared an adult age band @param {{ ageBand?: string | null } | null | undefined} user */
export function isAdultAccount(user) {
  return accountAge(user) === 'ADULT';
}

/**
 * The declared band of a citizen account (null when none), read from the database.
 * @param {string} userId
 * @param {typeof defaultDb} [database] a drizzle client
 * @returns {Promise<{ ageBand: string | null }>}
 */
export async function loadAccountAge(userId, database = defaultDb) {
  const rows = await database.select({ ageBand: CitizenProfile.ageBand }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  return { ageBand: rows[0]?.ageBand ?? null };
}

/**
 * The refusal of a booking for this account, or null when it may book.
 * @param {{ ageBand?: string | null }} user
 * @returns {null | { status: number, body: { error: string, code: string, message: string } }}
 */
export function bookingAgeRefusal(user) {
  const age = accountAge(user);
  if (age === 'ADULT') return null;
  if (age === 'MINOR') {
    return { status: 403, body: { error: 'ADULT_ACCOUNT_REQUIRED', code: 'ADULT_ACCOUNT_REQUIRED',
      message: 'La prise de rendez-vous en ligne est réservée aux personnes majeures. Une personne mineure peut contacter directement la structure, avec un représentant légal si besoin.' } };
  }
  return { status: 409, body: { error: 'AGE_DECLARATION_REQUIRED', code: 'AGE_DECLARATION_REQUIRED',
    message: 'Indiquez votre tranche d’âge dans votre compte avant de demander un rendez-vous.' } };
}
