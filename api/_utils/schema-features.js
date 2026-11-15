// @ts-nocheck
/**
 * R40 / G10 — which optional columns this database actually has. The scheduled jobs run against the database as migrated, which can be behind the code:
 * Production is at migration 0042 while the account-free booking columns of ProAppointment come with 0043 (guest booking) and 0044 (guest reminder
 * consent). A job reads the information schema ONCE per run and leaves out the guest parts the database does not have yet, instead of failing on a missing
 * column. Nothing is cached across runs: applying the migration later is picked up by the next run.
 */
import { Table, getTableColumns, sql } from 'drizzle-orm';
import { ProAppointment, ProRdvService, Referral, StructureRdvSettings } from '../../src/db/schema.js';

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

/**
 * R41-B — the same detection for REQUEST paths (the account-based appointment surface must work on a 0042 database: Production today). Read at most once
 * per GUEST_SCHEMA_TTL_MS per process (a migration applied later is picked up within that delay); a failed read is not remembered.
 */
export const GUEST_SCHEMA_TTL_MS = 60_000;
const requestCache = new WeakMap();
/** @param {any} database @returns {Promise<{ guestBooking: boolean, guestReminderConsent: boolean }>} */
export function requestGuestSchema(database) {
  const hit = requestCache.get(database);
  if (hit && Date.now() - hit.at < GUEST_SCHEMA_TTL_MS) return hit.value;
  const value = appointmentGuestSchema(database);
  requestCache.set(database, { at: Date.now(), value });
  value.catch(() => { if (requestCache.get(database)?.value === value) requestCache.delete(database); });
  return value;
}

/** the 0043 columns of the two other tables (0043 is applied in one transaction: guestBooking true means they exist too) */
export const GUEST_SERVICE_COLUMN = 'guestBookable';
export const GUEST_SETTINGS_COLUMN = 'allowGuestBooking';
/** @param {{ guestBooking: boolean, guestReminderConsent: boolean }} f @returns {string[]} the ProAppointment columns this database does not have */
const missingAppointmentColumns = (f) => [...(f.guestBooking ? [] : GUEST_BOOKING_COLUMNS), ...(f.guestReminderConsent ? [] : [GUEST_REMINDER_COLUMN])];

const clones = new Map();
/**
 * the table object without the given columns, for insert / update / select / returning on a database that does not have them (drizzle lists EVERY column of
 * the table object in an INSERT and in select() / returning() without fields). Same SQL name, same column objects; cached.
 * @template T @param {T} table @param {string[]} missing @returns {T}
 */
function without(table, missing) {
  if (!missing.length) return table;
  const key = `${table[Table.Symbol.Name]}:${missing.join(',')}`;
  if (clones.has(key)) return clones.get(key);
  const clone = Object.create(Object.getPrototypeOf(table));
  for (const k of Reflect.ownKeys(table)) if (!missing.includes(k)) Object.defineProperty(clone, k, Object.getOwnPropertyDescriptor(table, k));
  clone[Table.Symbol.Columns] = Object.fromEntries(Object.entries(table[Table.Symbol.Columns]).filter(([k]) => !missing.includes(k)));
  clones.set(key, clone);
  return clone;
}
/** ProAppointment as this database has it @param {{ guestBooking: boolean, guestReminderConsent: boolean }} f @returns {typeof ProAppointment} */
export const appointmentTable = (f) => without(ProAppointment, missingAppointmentColumns(f));
/** ProRdvService as this database has it @param {{ guestBooking: boolean }} f @returns {typeof ProRdvService} */
export const serviceTable = (f) => without(ProRdvService, f.guestBooking ? [] : [GUEST_SERVICE_COLUMN]);
/** StructureRdvSettings as this database has it @param {{ guestBooking: boolean }} f @returns {typeof StructureRdvSettings} */
export const settingsTable = (f) => without(StructureRdvSettings, f.guestBooking ? [] : [GUEST_SETTINGS_COLUMN]);
/**
 * { key: true } for every column of a table object (the `columns` option of a relational query). Typed with every column of the full table: on a database
 * without the guest columns those keys are simply absent at run time (read as undefined, like a NULL guest value).
 * @template {import('drizzle-orm').Table} T @param {T} table @returns {{ [K in keyof T['_']['columns']]: true }}
 */
export const flagsOf = (table) => Object.fromEntries(Object.keys(table[Table.Symbol.Columns]).map((k) => [k, true]));

/**
 * R43-E — the AppointmentNotice kinds the ledger CHECK of THIS database accepts. Migration 0045 widens "AppointmentNotice_kind_check" with the four
 * booking kinds (NOTICE_KINDS_0045); Production may still be at 0042 when the code is released, so a writer asks before recording one of them (a CHECK
 * violation would only be logged and lost). Read from pg_constraint at most once per GUEST_SCHEMA_TTL_MS per process; a failed read answers null and is
 * not remembered (the caller then behaves as before 0045: these kinds are skipped, never recorded under another kind).
 */
export const NOTICE_KINDS_0045 = Object.freeze(['BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED']);
const ledgerCache = new WeakMap();
/** @param {any} database a drizzle client with execute() @returns {Promise<Set<string> | null>} null = unknown (no CHECK found, or the read failed) */
async function readLedgerKinds(database) {
  const res = await database.execute(sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'AppointmentNotice' AND t.relnamespace = current_schema()::regnamespace AND c.conname = 'AppointmentNotice_kind_check'`);
  const def = String((res?.rows || res || [])[0]?.def || '');
  if (!def) return null;
  return new Set([...def.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]));
}
/** @param {any} database @returns {Promise<Set<string> | null>} */
export function noticeLedgerKinds(database) {
  if (!database || typeof database.execute !== 'function') return Promise.resolve(null);
  const hit = ledgerCache.get(database);
  if (hit && Date.now() - hit.at < GUEST_SCHEMA_TTL_MS) return hit.value;
  const value = readLedgerKinds(database).catch(() => null);
  ledgerCache.set(database, { at: Date.now(), value });
  value.then((kinds) => { if (!kinds && ledgerCache.get(database)?.value === value) ledgerCache.delete(database); });
  return value;
}
/** for the tests: forget what was read (a migration applied or rolled back inside one process) */
export function forgetNoticeLedgerKinds(database) { ledgerCache.delete(database); }

/**
 * M2 — migrations 0047 (referral redirect, follow-up notice, « référent de parcours ») and 0048 (history of the referral texts). The code may be released before the migration is authorized on a
 * database (Production): every path that existed before M2 must keep working there — the referral-timeouts cron, the person withdrawing an access, a
 * member's departure, an organization's closure. drizzle names EVERY column of a table object in select() / insert() / returning(), so those paths use
 * referralTable(f) (the table without the 0047 columns when the database does not have them); the new features answer « not available » instead of
 * failing. Read at most once per GUEST_SCHEMA_TTL_MS per database object; a failed read is not remembered.
 */
export const REFERRAL_CHAIN_COLUMNS = Object.freeze(['previousReferralId', 'suggestedStructureId', 'followUpNotifiedAt']);
/**
 * @param {any} database a drizzle client (or transaction) with execute()
 * @returns {Promise<{ chain: boolean, referent: boolean, messages: boolean }>} chain = the three 0047 columns of "Referral" exist; referent = "DossierReferent" and
 *   its event table exist (0047); messages = "ReferralMessage" exists (0048, the history of the texts exchanged on a referral)
 */
export async function readReferralChainSchema(database) {
  const res = await database.execute(sql`SELECT
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Referral'
      AND column_name IN (${sql.join(REFERRAL_CHAIN_COLUMNS.map((c) => sql`${c}`), sql`, `)})) AS cols,
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('DossierReferent', 'DossierReferentEvent')) AS tables,
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ReferralMessage') AS messages`);
  const row = (res?.rows || res || [])[0] || {};
  return { chain: Number(row.cols) === REFERRAL_CHAIN_COLUMNS.length, referent: Number(row.tables) === 2, messages: Number(row.messages) === 1 };
}
const chainCache = new WeakMap();
/** @param {any} database @returns {Promise<{ chain: boolean, referent: boolean, messages: boolean }>} */
export function referralChainSchema(database) {
  const hit = chainCache.get(database);
  if (hit && Date.now() - hit.at < GUEST_SCHEMA_TTL_MS) return hit.value;
  const value = readReferralChainSchema(database);
  chainCache.set(database, { at: Date.now(), value });
  value.catch(() => { if (chainCache.get(database)?.value === value) chainCache.delete(database); });
  return value;
}
/** for the tests: forget what was read (a migration applied or rolled back inside one process) */
export function forgetReferralChainSchema(database) { chainCache.delete(database); }
/** Referral as this database has it @param {{ chain: boolean }} f @returns {typeof Referral} */
export const referralTable = (f) => without(Referral, f.chain ? [] : [...REFERRAL_CHAIN_COLUMNS]);
