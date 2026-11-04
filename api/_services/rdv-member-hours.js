/**
 * R42-CDGG — per-professional working hours and dated exceptions (owner: « A professional should be able to define normal weekly working hours,
 * configure exceptional availability or unavailability, change schedules »), on the Production schema 0042: NO migration, NO new column.
 *
 * Storage: the key `rdvMemberHours` of Structure.settings_json (jsonb, default '{}', never returned by a public API — api/_handlers/structures.js leaves
 * the column out), one entry per member id of THAT structure:
 *   { v: 1, weekly: null | Array<{ weekday 0-6, startTime 'HH:MM', endTime 'HH:MM' }>, exceptions: Array<{ id, kind: 'AVAILABLE' | 'UNAVAILABLE',
 *     from 'YYYY-MM-DD', to 'YYYY-MM-DD', startTime?: 'HH:MM', endTime?: 'HH:MM' }>, updatedAt }
 * It is a different key from `rdvBooking` (api/_services/rdv-booking-config.js), so a booking-rules change never overwrites a member's hours and a
 * member's change touches only their own entry (one atomic UPDATE, see writeMemberHours).
 *
 * Times are WALL-CLOCK Europe/Paris (converted per date with zonedWallTimeToUtc: DST correct). `weekly: null` = « follows the structure's opening hours »
 * (the R42-BOOK behaviour, unchanged for anyone who configures nothing); `weekly: []` = no regular day (only the exceptional availabilities).
 * An exception without times covers the whole Paris day(s) from..to; with times, those hours on each day of the range (« monthly » configuration = a range).
 *
 * Availability of one professional (team booking, api/_services/rdv-team.js):
 *   structure opening rules (slots are only ever generated from them)
 *   ∩ ( member weekly hours if defined, else everything ) ∪ member AVAILABLE exceptions      ← an extra availability never opens hours the structure is closed:
 *   − member UNAVAILABLE exceptions (win over AVAILABLE)                                        the safe rule — no slot outside the structure's published hours
 *   − closures − absences − appointments − Outlook busy (unchanged, rdv-team.js)
 * A slot must lie entirely inside one allowed window; the buffers are checked against busy time only (as the structure engine does).
 * Applies where bookings are assigned to a professional (team choice enabled); a structure without team choice keeps its single agenda.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { zonedParts, zonedWallTimeToUtc } from '../_utils/pro-rdv.js';

export const PARIS = 'Europe/Paris';
export const MAX_WEEKLY_RANGES = 28;
export const MAX_EXCEPTIONS = 60;
export const MAX_EXCEPTION_DAYS = 366;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** @typedef {{ weekday: number, startTime: string, endTime: string }} WeeklyRange */
/** @typedef {{ id: string, kind: 'AVAILABLE' | 'UNAVAILABLE', from: string, to: string, startTime: string | null, endTime: string | null }} HoursException */
/** @typedef {{ v: 1, weekly: WeeklyRange[] | null, exceptions: HoursException[], updatedAt: string | null }} MemberHours */
/** @typedef {{ start: Date, end: Date }} Interval */
/** @typedef {{ allow: Interval[] | null, block: Interval[] }} MemberWindows allow null = no restriction beyond the structure's rules */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {string} t */
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** a real calendar date 'YYYY-MM-DD' → [y, m0, d] or null @param {unknown} v @returns {[number, number, number] | null} */
export function parseDate(v) {
  if (typeof v !== 'string') return null;
  const m = DATE.exec(v);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1; const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo && t.getUTCDate() === d ? [y, mo, d] : null;
}

/** @returns {MemberHours} */
export const emptyMemberHours = () => ({ v: 1, weekly: null, exceptions: [], updatedAt: null });

/**
 * Validates one member's hours as sent by the professional. Errors are French sentences (shown as is by the screen).
 * @param {unknown} body @returns {{ error: string } | { hours: MemberHours }}
 */
export function validateMemberHours(body) {
  if (!isObject(body)) return { error: 'Horaires invalides.' };
  /** @type {WeeklyRange[] | null} */
  let weekly = null;
  if (body.weekly !== null && typeof body.weekly !== 'undefined') {
    if (!Array.isArray(body.weekly) || body.weekly.length > MAX_WEEKLY_RANGES) return { error: `Les horaires hebdomadaires doivent être une liste (au plus ${MAX_WEEKLY_RANGES} plages).` };
    weekly = [];
    for (const r of body.weekly) {
      if (!isObject(r) || !Number.isInteger(r.weekday) || Number(r.weekday) < 0 || Number(r.weekday) > 6) return { error: 'Jour de la semaine invalide.' };
      if (typeof r.startTime !== 'string' || typeof r.endTime !== 'string' || !TIME.test(r.startTime) || !TIME.test(r.endTime)) return { error: 'Heure invalide (format HH:MM).' };
      if (minutes(r.endTime) <= minutes(r.startTime)) return { error: 'Une plage horaire doit finir après son début.' };
      weekly.push({ weekday: Number(r.weekday), startTime: r.startTime, endTime: r.endTime });
    }
    weekly.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < weekly.length; i += 1) {
      if (weekly[i].weekday === weekly[i - 1].weekday && minutes(weekly[i].startTime) < minutes(weekly[i - 1].endTime)) return { error: 'Deux plages du même jour se chevauchent.' };
    }
  }
  /** @type {HoursException[]} */
  const exceptions = [];
  const raw = typeof body.exceptions === 'undefined' ? [] : body.exceptions;
  if (!Array.isArray(raw) || raw.length > MAX_EXCEPTIONS) return { error: `Les exceptions doivent être une liste (au plus ${MAX_EXCEPTIONS}).` };
  for (const e of raw) {
    if (!isObject(e) || (e.kind !== 'AVAILABLE' && e.kind !== 'UNAVAILABLE')) return { error: 'Type d’exception invalide (disponible ou indisponible).' };
    const from = parseDate(e.from); const to = parseDate(e.to);
    if (!from || !to) return { error: 'Date d’exception invalide (format AAAA-MM-JJ).' };
    const span = (Date.UTC(...to) - Date.UTC(...from)) / DAY_MS;
    if (span < 0) return { error: 'La date de fin d’une exception doit être le même jour ou après la date de début.' };
    if (span >= MAX_EXCEPTION_DAYS) return { error: `Une exception couvre au plus ${MAX_EXCEPTION_DAYS} jours.` };
    const hasTimes = (e.startTime ?? null) !== null || (e.endTime ?? null) !== null;
    if (hasTimes) {
      if (typeof e.startTime !== 'string' || typeof e.endTime !== 'string' || !TIME.test(e.startTime) || !TIME.test(e.endTime)) return { error: 'Heure d’exception invalide (format HH:MM).' };
      if (minutes(e.endTime) <= minutes(e.startTime)) return { error: 'Une plage horaire doit finir après son début.' };
    }
    const id = typeof e.id === 'string' && ID.test(e.id) ? e.id : `x${exceptions.length + 1}`;
    exceptions.push({ id, kind: e.kind, from: String(e.from), to: String(e.to), startTime: hasTimes ? String(e.startTime) : null, endTime: hasTimes ? String(e.endTime) : null });
  }
  exceptions.sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
  return { hours: { v: 1, weekly, exceptions, updatedAt: new Date().toISOString() } };
}

/** the stored value, made safe (anything malformed reads as « not configured ») @param {unknown} raw @returns {MemberHours} */
export function parseMemberHours(raw) {
  if (!isObject(raw)) return emptyMemberHours();
  const checked = validateMemberHours(raw);
  if ('error' in checked) return emptyMemberHours();
  return { ...checked.hours, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null };
}

/** has this member configured anything @param {MemberHours} h */
export const isConfigured = (h) => h.weekly !== null || h.exceptions.length > 0;

/**
 * The hours of these members of one structure (a member of another structure is never read: the key lives in THIS structure's row).
 * @param {string} structureId @param {string[]} memberIds @param {{ execute: typeof defaultDb.execute }} [runner] the pool or a transaction
 * @returns {Promise<Map<string, MemberHours>>}
 */
export async function readMemberHours(structureId, memberIds, runner = defaultDb) {
  const res = await runner.execute(sql`SELECT settings_json -> 'rdvMemberHours' AS h FROM "Structure" WHERE id = ${structureId}`);
  /** @type {Array<Record<string, unknown>>} */
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  const all = rows[0]?.h;
  /** @type {Map<string, MemberHours>} */
  const out = new Map();
  for (const id of memberIds) out.set(id, parseMemberHours(isObject(all) ? all[id] : null));
  return out;
}

/**
 * Replaces ONE member's entry atomically (the other members' entries and the other keys of settings_json are kept). `null` removes it.
 * @param {string} structureId @param {string} memberId @param {MemberHours | null} hours @param {typeof defaultDb} [database]
 */
export async function writeMemberHours(structureId, memberId, hours, database = defaultDb) {
  if (!ID.test(memberId)) throw new Error('invalid member id');
  if (hours === null) {
    await database.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rdvMemberHours}',
      coalesce(settings_json -> 'rdvMemberHours', '{}'::jsonb) - ${memberId}::text, true) WHERE id = ${structureId}`);
    return;
  }
  await database.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{rdvMemberHours}',
    coalesce(settings_json -> 'rdvMemberHours', '{}'::jsonb) || jsonb_build_object(${memberId}::text, ${JSON.stringify(hours)}::jsonb), true) WHERE id = ${structureId}`);
}

/**
 * The Paris calendar dates touching [from, to] (one day of margin on each side), as [y, m0, d].
 * @param {Date} from @param {Date} to @returns {Array<[number, number, number]>}
 */
function parisDates(from, to) {
  const a = zonedParts(from.getTime() - DAY_MS, PARIS); const b = zonedParts(to.getTime() + DAY_MS, PARIS);
  if (!a || !b) return [];
  /** @type {Array<[number, number, number]>} */
  const out = [];
  for (let t = Date.UTC(a.year, a.month - 1, a.day); t <= Date.UTC(b.year, b.month - 1, b.day) && out.length < 800; t += DAY_MS) {
    const d = new Date(t); out.push([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]);
  }
  return out;
}

/** @param {[number, number, number]} d @param {string | null} start @param {string | null} end @returns {Interval} */
function wall(d, start, end) {
  if (start === null || end === null) {
    const next = new Date(Date.UTC(d[0], d[1], d[2]) + DAY_MS);
    return { start: zonedWallTimeToUtc(d[0], d[1], d[2], '00:00', PARIS), end: zonedWallTimeToUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), '00:00', PARIS) };
  }
  return { start: zonedWallTimeToUtc(d[0], d[1], d[2], start, PARIS), end: zonedWallTimeToUtc(d[0], d[1], d[2], end, PARIS) };
}

/** @param {[number, number, number]} d */
const iso = (d) => `${d[0]}-${String(d[1] + 1).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;

/**
 * The UTC windows of one member's hours over a range.
 * @param {MemberHours} hours @param {{ from: Date, to: Date }} range @returns {MemberWindows}
 */
export function memberWindows(hours, range) {
  if (!isConfigured(hours)) return { allow: null, block: [] };
  const dates = parisDates(range.from, range.to);
  /** @type {Interval[]} */ const allow = [];
  /** @type {Interval[]} */ const block = [];
  for (const d of dates) {
    const day = iso(d);
    const weekday = new Date(Date.UTC(d[0], d[1], d[2])).getUTCDay();
    if (hours.weekly === null) allow.push(wall(d, null, null));
    else for (const r of hours.weekly) if (r.weekday === weekday) allow.push(wall(d, r.startTime, r.endTime));
    for (const e of hours.exceptions) {
      if (day < e.from || day > e.to) continue;
      (e.kind === 'AVAILABLE' ? allow : block).push(wall(d, e.startTime, e.endTime));
    }
  }
  return { allow: merge(allow), block };
}

/** touching or overlapping windows become one (a slot may span a weekly range and an adjacent extra availability) @param {Interval[]} list */
function merge(list) {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  /** @type {Interval[]} */
  const out = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) { if (w.end > last.end) last.end = w.end; } else out.push({ start: w.start, end: w.end });
  }
  return out;
}

/** is [start, end] inside the member's hours and outside their unavailability @param {MemberWindows} w @param {Date} start @param {Date} end */
export function allowedBy(w, start, end) {
  if (w.block.some((b) => start < b.end && b.start < end)) return false;
  if (w.allow === null) return true;
  return w.allow.some((a) => a.start <= start && end <= a.end);
}
