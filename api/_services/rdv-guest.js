/**
 * R42 (owner decision DEC-R42-01, 04/11/2026) — the R38 account-free (« sans compte ») public booking is RETIRED, permanently and server-side:
 * « There shall be no public account-free booking capability. »
 *
 * Every rdv/guest/… route (structures/:slug/services, structures/:slug/slots, hold, confirm, manage, manage/cancel, manage/reschedule, manage/reminder),
 * whatever the method, answers 410 ACCOUNT_REQUIRED — before the body, the database or the mailer is read, and whatever ADA_GUEST_BOOKING_ENABLED
 * says (that switch can no longer re-enable anything: it is not read here) and whatever the database level (0042 or 0044).
 *
 * What was reused for the account-based path (see CONTROL/r42/R42_GUEST_BOOKING_DEACTIVATION.md): the shared engine already in api/_handlers/rdv.js
 * (bookSlot / moveSlot under the in-process + advisory locks, idempotency replay under the lock, the « still active » rule, the Paris-day lock key), the
 * decoy-parity principle (one identical answer whatever the hidden state) applied to the professional choice (api/_services/rdv-team.js), the sealed
 * note (now the optional message), the notice ledger and the reminder job. The implementation of the retired routes is in the Git history (R38–R41);
 * migrations 0043 / 0044 and their data stay untouched (gdpr-purge keeps purging any LAB guest row).
 */

export const GUEST_BOOKING_RETIRED = Object.freeze({
  error: 'ACCOUNT_REQUIRED',
  code: 'ACCOUNT_REQUIRED',
  message: 'La prise de rendez-vous sans compte n’existe plus. Connectez-vous ou créez un compte pour demander un rendez-vous ; les informations sur les structures restent consultables sans compte.',
});

/**
 * @param {import('../_utils/http-types').ApiRequest} _req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function guestHandler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json(GUEST_BOOKING_RETIRED);
}
