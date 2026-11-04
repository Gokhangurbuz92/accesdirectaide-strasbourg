/**
 * R42 (owner decisions R42-A03 / R42-A04) — the booking configuration a structure controls, on the Production schema 0042 (no new column):
 *   - confirmation per structure and per service: 'DIRECT' (Mode A, the request is confirmed at once) or 'APPROVAL' (Mode B, the structure accepts or refuses);
 *   - team choice: whether the person may choose a professional, and for each member whether they take bookings (no-preference routing) and whether they
 *     are publicly selectable, and for which services.
 *
 * Stored under the key `rdvBooking` of Structure.settings_json (jsonb, default '{}', present since the first migration and read nowhere else). That column
 * is never returned by a public API (api/_handlers/structures.js leaves it out). Unknown or malformed content reads as the safe defaults below; a write is
 * validated by api/_handlers/pro/rdv-settings.js (members and services of the structure only) and journaled there.
 *
 * Default when nothing is configured: Mode A (the R41 behaviour: a booking is confirmed at once) and no team choice (the structure is one agenda).
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';

/** @typedef {'DIRECT' | 'APPROVAL'} ConfirmationMode */
/** @typedef {{ bookable: boolean, selectable: boolean, serviceIds: string[] }} MemberConfig */
/** @typedef {{ v: 1, confirmation: ConfirmationMode, services: Record<string, { confirmation: ConfirmationMode }>, team: { enabled: boolean, members: Record<string, MemberConfig> } }} BookingConfig */

export const CONFIRMATION_MODES = Object.freeze(['DIRECT', 'APPROVAL']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** @returns {BookingConfig} */
export function defaultBookingConfig() {
  return { v: 1, confirmation: 'DIRECT', services: {}, team: { enabled: false, members: {} } };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {ConfirmationMode | null} */
export const asConfirmation = (v) => (v === 'DIRECT' || v === 'APPROVAL' ? v : null);

/**
 * The configuration as stored, made safe: anything unknown is dropped.
 * @param {unknown} raw the `rdvBooking` value of settings_json
 * @returns {BookingConfig}
 */
export function parseBookingConfig(raw) {
  const out = defaultBookingConfig();
  if (!isObject(raw)) return out;
  out.confirmation = asConfirmation(raw.confirmation) || 'DIRECT';
  if (isObject(raw.services)) {
    for (const [id, value] of Object.entries(raw.services)) {
      const mode = isObject(value) ? asConfirmation(value.confirmation) : null;
      if (ID.test(id) && mode) out.services[id] = { confirmation: mode };
    }
  }
  if (isObject(raw.team)) {
    out.team.enabled = raw.team.enabled === true;
    if (isObject(raw.team.members)) {
      for (const [id, value] of Object.entries(raw.team.members)) {
        if (!ID.test(id) || !isObject(value)) continue;
        const bookable = value.bookable === true;
        out.team.members[id] = {
          bookable,
          selectable: bookable && value.selectable === true,   // a selectable professional always takes bookings
          serviceIds: Array.isArray(value.serviceIds) ? value.serviceIds.filter((s) => typeof s === 'string' && ID.test(s)).slice(0, 100) : [],
        };
      }
    }
  }
  return out;
}

/** Mode A or Mode B for one service: the service's own setting, else the structure's @param {BookingConfig} config @param {string} serviceId @returns {ConfirmationMode} */
export function confirmationModeFor(config, serviceId) {
  return config.services[serviceId]?.confirmation || config.confirmation;
}

/** does this member serve this service (an empty list = every service) @param {MemberConfig} member @param {string} serviceId */
export const memberServes = (member, serviceId) => member.serviceIds.length === 0 || member.serviceIds.includes(serviceId);

/**
 * @param {string} structureId
 * @param {typeof defaultDb} [database]
 * @returns {Promise<BookingConfig>}
 */
export async function readBookingConfig(structureId, database = defaultDb) {
  const res = await database.execute(sql`SELECT settings_json -> 'rdvBooking' AS cfg FROM "Structure" WHERE id = ${structureId}`);
  /** @type {Array<Record<string, unknown>>} */
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  return parseBookingConfig(rows[0]?.cfg ?? null);
}

/**
 * Replaces the `rdvBooking` key only (the other keys of settings_json are kept).
 * @param {string} structureId @param {BookingConfig} config @param {typeof defaultDb} [database]
 */
export async function writeBookingConfig(structureId, config, database = defaultDb) {
  const clean = parseBookingConfig(config);
  await database.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rdvBooking}', ${JSON.stringify(clean)}::jsonb, true) WHERE id = ${structureId}`);
  return clean;
}
