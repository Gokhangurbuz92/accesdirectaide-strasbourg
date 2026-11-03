// @ts-nocheck
/**
 * R40 / G10 — which optional columns this database actually has. The scheduled jobs run against the database as migrated, which can be behind the code:
 * Production is at migration 0042 while the account-free booking columns of ProAppointment come with 0043 (guest booking) and 0044 (guest reminder
 * consent). A job reads the information schema ONCE per run and leaves out the guest parts the database does not have yet, instead of failing on a missing
 * column. Nothing is cached across runs: applying the migration later is picked up by the next run.
 */
import { getTableColumns, sql } from 'drizzle-orm';
import { ProAppointment } from '../../src/db/schema.js';

/** ProAppointment columns added by drizzle/0043_r38_guest_booking.sql (schema keys = column names) */
export const GUEST_BOOKING_COLUMNS = Object.freeze(['guestEmail', 'guestEmailHash', 'guestPhone', 'guestMailConsentAt', 'guestHoldExpiresAt', 'guestCodeHash',
  'guestCodeAttempts', 'guestConfirmedAt', 'guestManageTokenHash', 'guestManageExpiresAt']);
/** ProAppointment column added by drizzle/0044_r39_guest_reminder_consent.sql */
export const GUEST_REMINDER_COLUMN = 'guestReminderConsentAt';

/**
 * @param {any} database a drizzle client (or transaction) with execute()
 * @returns {Promise<{ guestBooking: boolean, guestReminderConsent: boolean }>} guestBooking = every 0043 column exists; guestReminderConsent = 0043 and the 0044 column
 */
export async function appointmentGuestSchema(database) {
  const wanted = [...GUEST_BOOKING_COLUMNS, GUEST_REMINDER_COLUMN];
  const res = await database.execute(sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ProAppointment' AND column_name IN (${sql.join(wanted.map((c) => sql`${c}`), sql`, `)})`);
  const have = new Set((res?.rows || res || []).map((r) => String(r.column_name)));
  const guestBooking = GUEST_BOOKING_COLUMNS.every((c) => have.has(c));
  return { guestBooking, guestReminderConsent: guestBooking && have.has(GUEST_REMINDER_COLUMN) };
}

/**
 * The ProAppointment columns that exist for these features, as drizzle column objects keyed by their schema key — for `.returning(cols)` and, through
 * columnFlags(), for the `columns` option of a relational query (drizzle otherwise selects every column of the schema, including the missing ones).
 * @param {{ guestBooking: boolean, guestReminderConsent: boolean }} f
 */
export function appointmentColumns(f) {
  const out = {};
  for (const [key, col] of Object.entries(getTableColumns(ProAppointment))) {
    if (GUEST_BOOKING_COLUMNS.includes(key) && !f.guestBooking) continue;
    if (key === GUEST_REMINDER_COLUMN && !f.guestReminderConsent) continue;
    out[key] = col;
  }
  return out;
}

/** { key: true } for every column of appointmentColumns(f) @param {{ guestBooking: boolean, guestReminderConsent: boolean }} f */
export function columnFlags(f) {
  return Object.fromEntries(Object.keys(appointmentColumns(f)).map((k) => [k, true]));
}
