/**
 * R42 (owner decision R42-A04) — professional selection for an account-based appointment, and the per-professional availability it needs.
 *
 * Choice offered to the person (only when the structure enabled team choice, api/_services/rdv-booking-config.js):
 *   - 'ANY'        no preference: the request is routed to a free professional who takes bookings for the service (least booked that day, then a fixed order);
 *   - a handle     one PUBLICLY SELECTABLE professional (opaque per-structure handle, never the account id or the e-mail);
 *   - 'PREVIOUS'   the professional of one of THIS person's own past appointments in this structure — offered only to that signed-in person, only while that
 *                  professional still takes bookings for the service. Never exposed publicly; the professional's name is shown only when they are
 *                  publicly selectable anyway.
 * A member is a candidate when: active ProUser of the structure, role PRO or STRUCTURE_ADMIN, MFA enrolled (verified sign-in), configured `bookable` for
 * that service by the structure. The public list adds `selectable` and a ProProfile display name.
 *
 * Privacy (no relationship oracle): resolveChoice() runs the SAME queries whatever is asked (candidates + the person's previous set), and every refusal
 * — unknown handle, a member who is not selectable, someone else's previous professional, nobody previous — is one identical 409 PROFESSIONAL_UNAVAILABLE.
 *
 * Assignment on the Production schema 0042 (no new column): the professional of an appointment is ProAppointment.createdByProUserId — the column the
 * agenda already reads as « this member's appointment » (pro/timeoff.js member-absence clashes, org-stats per member). For a citizen booking it was NULL.
 *
 * Per-professional availability = the structure's opening rules, narrowed by the member's own weekly hours and dated exceptions when they configured them
 * (R42-CDGG, api/_services/rdv-member-hours.js: an extra availability stays inside the structure's rules; an unavailability wins), minus: closures of the structure; the member's
 * own absences (ProTimeOff.proUserId); the active appointments assigned to that member AND the unassigned ones (an unassigned appointment blocks
 * everyone: fail safe); the busy intervals of the member's connected Outlook calendar (api/_services/rdv-calendar-busy.js — a required check that cannot
 * be made removes all of that member's slots).
 */
import crypto from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProAppointment, ProAvailabilityRule, ProRdvService, ProTimeOff } from '../../src/db/schema.js';
import { generateSlots, toBusyWindows } from '../_utils/pro-rdv.js';
import { activeAppointmentWhere } from '../_utils/rdv-active.js';
import { appointmentTable, requestGuestSchema } from '../_utils/schema-features.js';
import { rulesFor } from '../lib/appointment-modes.js';
import { memberServes } from './rdv-booking-config.js';
import { calendarBusyFor } from './rdv-calendar-busy.js';
import { allowedBy, memberWindows, readMemberHours } from './rdv-member-hours.js';

const PROCESS_LOCAL_SECRET = crypto.randomBytes(32);
export const PREVIOUS = 'PREVIOUS';
export const ANY = 'ANY';
export const PROFESSIONAL_UNAVAILABLE = Object.freeze({ error: 'PROFESSIONAL_UNAVAILABLE', code: 'PROFESSIONAL_UNAVAILABLE',
  message: 'Ce choix n’est pas disponible pour ce service. Choisissez « Pas de préférence » ou une autre personne.' });

/** @typedef {{ id: string, email: string, displayName: string | null, jobTitle: string | null, selectable: boolean }} Candidate */
/** @typedef {import('./rdv-booking-config.js').BookingConfig} BookingConfig */
/** @typedef {{ id: string, durationMinutes: number, bufferBeforeMinutes: number, bufferAfterMinutes: number }} ServiceLike */
/** @typedef {{ startAt: string, endAt: string, pros: string[] }} TeamSlot */
/** @typedef {typeof defaultDb | Parameters<Parameters<typeof defaultDb.transaction>[0]>[0]} Runner the pool or a transaction */

function handleSecret() {
  const configured = [process.env.RDV_CONFIRMATION_TOKEN_SECRET, process.env.AUTH_SECRET, process.env.JWT_SECRET, process.env.SESSION_SECRET].find((v) => typeof v === 'string' && v.length >= 32);
  return configured ? Buffer.from(configured, 'utf8') : PROCESS_LOCAL_SECRET;
}

/** the public, per-structure handle of a professional (opaque, stable, not reversible) @param {string} structureId @param {string} proUserId */
export function professionalHandle(structureId, proUserId) {
  return `p_${crypto.createHmac('sha256', handleSecret()).update(`ada/rdv-professional/v1|${structureId}|${proUserId}`).digest('base64url').slice(0, 22)}`;
}

/**
 * The members of the structure who may receive bookings for this service, in a fixed order.
 * @param {string} structureId @param {string} serviceId @param {BookingConfig} config @param {typeof defaultDb} [database]
 * @returns {Promise<Candidate[]>}
 */
export async function candidatesFor(structureId, serviceId, config, database = defaultDb) {
  const res = await database.execute(sql`SELECT u.id, u.email, p."displayName" AS "displayName", p."jobTitle" AS "jobTitle"
    FROM "ProUser" u LEFT JOIN "ProProfile" p ON p."proUserId" = u.id
    WHERE u."structureId" = ${structureId} AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN') AND u.mfa_enabled = true
    ORDER BY u.id`);
  /** @type {Array<Record<string, unknown>>} */
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  /** @type {Candidate[]} */
  const out = [];
  if (!config.team.enabled) return out;
  for (const r of rows) {
    const id = String(r.id);
    const member = config.team.members[id];
    if (!member || !member.bookable || !memberServes(member, serviceId)) continue;
    const displayName = typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName.trim().slice(0, 80) : null;
    out.push({ id, email: String(r.email), displayName, jobTitle: typeof r.jobTitle === 'string' && r.jobTitle.trim() ? r.jobTitle.trim().slice(0, 80) : null,
      // selectable needs a public display name: a professional is never shown by e-mail
      selectable: member.selectable && Boolean(displayName) });
  }
  return out;
}

/**
 * The professionals of THIS person's own past appointments in this structure (most recent first).
 * @param {string} citizenUserId @param {string} structureId @param {typeof defaultDb} [database] @returns {Promise<string[]>}
 */
export async function previousProfessionalIds(citizenUserId, structureId, database = defaultDb) {
  const res = await database.execute(sql`SELECT "createdByProUserId" AS pro, max("startAt") AS last FROM "ProAppointment"
    WHERE "citizenUserId" = ${citizenUserId} AND "structureId" = ${structureId} AND "createdByProUserId" IS NOT NULL
      AND status IN ('done', 'confirmed', 'booked') AND "startAt" < NOW()
    GROUP BY "createdByProUserId" ORDER BY last DESC LIMIT 5`);
  /** @type {Array<Record<string, unknown>>} */
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  return rows.map((r) => String(r.pro));
}

/**
 * What the booking screen may show: never an account id, an e-mail or a private relationship.
 * @param {{ structureId: string, serviceId: string, citizenUserId: string, config: BookingConfig }} input @param {typeof defaultDb} [database]
 */
export async function teamChoiceView({ structureId, serviceId, citizenUserId, config }, database = defaultDb) {
  const [candidates, previous] = await Promise.all([candidatesFor(structureId, serviceId, config, database), previousProfessionalIds(citizenUserId, structureId, database)]);
  const prev = previous.map((id) => candidates.find((c) => c.id === id)).find(Boolean) || null;
  return {
    choice: candidates.length > 0,
    noPreference: candidates.length > 0,
    professionals: candidates.filter((c) => c.selectable).map((c) => ({ id: professionalHandle(structureId, c.id), displayName: c.displayName, role: c.jobTitle })),
    previous: prev ? { available: true, displayName: prev.selectable ? prev.displayName : null } : { available: false, displayName: null },
  };
}

/**
 * The professionals a booking may go to, from the person's choice. Constant work whatever the choice (see the privacy note above).
 * @param {{ choice: unknown, structureId: string, serviceId: string, citizenUserId: string, config: BookingConfig }} input @param {typeof defaultDb} [database]
 * @returns {Promise<{ kind: 'NONE' } | { kind: 'ANY' | 'ONE', candidates: Candidate[] } | { kind: 'UNAVAILABLE' }>} NONE = the structure has no team choice
 */
export async function resolveChoice({ choice, structureId, serviceId, citizenUserId, config }, database = defaultDb) {
  const [candidates, previous] = await Promise.all([candidatesFor(structureId, serviceId, config, database), previousProfessionalIds(citizenUserId, structureId, database)]);
  const raw = choice === undefined || choice === null || choice === '' ? ANY : choice;
  const handles = candidates.map((c) => ({ c, h: professionalHandle(structureId, c.id) }));
  if (!config.team.enabled) return raw === ANY ? { kind: 'NONE' } : { kind: 'UNAVAILABLE' };
  if (typeof raw !== 'string' || raw.length > 64) return { kind: 'UNAVAILABLE' };
  if (raw === ANY) return candidates.length ? { kind: 'ANY', candidates } : { kind: 'UNAVAILABLE' };
  if (raw === PREVIOUS) {
    const prev = previous.map((id) => candidates.find((c) => c.id === id)).find(Boolean);
    return prev ? { kind: 'ONE', candidates: [prev] } : { kind: 'UNAVAILABLE' };
  }
  const picked = handles.find(({ c, h }) => c.selectable && h.length === raw.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(raw)));
  return picked ? { kind: 'ONE', candidates: [picked.c] } : { kind: 'UNAVAILABLE' };
}

/** @param {Date} d @param {number} days */
const plusDays = (d, days) => new Date(d.getTime() + days * 86_400_000);

/**
 * The active appointments of the structure over a range, with their professional and their service buffers.
 * @param {Runner} runner @param {string} structureId @param {{ from: Date, to: Date }} range @param {string | null} exceptId
 */
async function activeAppointments(runner, structureId, range, exceptId) {
  const features = await requestGuestSchema(defaultDb);
  const T = appointmentTable(features);
  const rows = await runner.select({ id: T.id, startAt: T.startAt, endAt: T.endAt, serviceId: T.serviceId, pro: T.createdByProUserId,
    bufferBeforeMinutes: ProRdvService.bufferBeforeMinutes, bufferAfterMinutes: ProRdvService.bufferAfterMinutes })
    .from(T).leftJoin(ProRdvService, eq(ProRdvService.id, T.serviceId))
    .where(and(eq(T.structureId, structureId), activeAppointmentWhere(ProAppointment, new Date(), features), lt(T.startAt, plusDays(range.to, 1)), gt(T.endAt, plusDays(range.from, -1))));
  const out = rows.filter((r) => r.id !== exceptId).map((r) => ({ id: r.id, startAt: r.startAt, endAt: r.endAt, pro: r.pro ?? null,
    service: { bufferBeforeMinutes: Number(r.bufferBeforeMinutes || 0), bufferAfterMinutes: Number(r.bufferAfterMinutes || 0) } }));
  return out;
}

/**
 * closures of the structure (proUserId NULL) and the absences of the given members over a range
 * @param {Runner} runner @param {string} structureId @param {string[]} proIds @param {{ from: Date, to: Date }} range
 */
async function timeOffs(runner, structureId, proIds, range) {
  const rows = await runner.select({ startAt: ProTimeOff.startAt, endAt: ProTimeOff.endAt, proUserId: ProTimeOff.proUserId }).from(ProTimeOff)
    .where(and(eq(ProTimeOff.structureId, structureId), proIds.length ? or(isNull(ProTimeOff.proUserId), inArray(ProTimeOff.proUserId, proIds)) : isNull(ProTimeOff.proUserId),
      lt(ProTimeOff.startAt, range.to), gt(ProTimeOff.endAt, range.from)));
  return rows;
}

/**
 * The busy windows of one professional, from rows already loaded.
 * @param {string} proId @param {Awaited<ReturnType<typeof activeAppointments>>} appointments @param {Awaited<ReturnType<typeof timeOffs>>} offs
 */
function busyOf(proId, appointments, offs) {
  return [
    ...toBusyWindows(appointments.filter((a) => a.pro === null || a.pro === proId)),
    ...offs.filter((o) => o.proUserId === null || o.proUserId === proId).map((o) => ({ start: o.startAt, end: o.endAt })),
  ];
}

/**
 * The bookable slots of a service and modality for these professionals, each slot with the professionals free then.
 * @param {{ structure: { id: string }, service: ServiceLike, mode: string, range: { from: Date, to: Date }, candidates: Candidate[], exceptId?: string | null,
 *   accept?: (slot: { startAt: string, endAt: string }) => boolean, calendar?: import('./rdv-calendar-busy.js').CalendarOptions }} input
 * @returns {Promise<{ rules: Array<{ timezone: string }>, slots: TeamSlot[], calendar: Record<string, string> }>} calendar: the check state per member id (internal, never returned to the public)
 */
export async function teamSlots({ structure, service, mode, range, candidates, exceptId = null, accept = () => true, calendar = {} }) {
  const rules = rulesFor(await defaultDb.query.ProAvailabilityRule.findMany({
    where: and(eq(ProAvailabilityRule.structureId, structure.id), eq(ProAvailabilityRule.isActive, true)),
    orderBy: [asc(ProAvailabilityRule.weekday), asc(ProAvailabilityRule.startTime)],
  }), mode);
  const [appointments, offs, hours] = await Promise.all([activeAppointments(defaultDb, structure.id, range, exceptId), timeOffs(defaultDb, structure.id, candidates.map((c) => c.id), range),
    readMemberHours(structure.id, candidates.map((c) => c.id))]);
  /** @type {Map<string, TeamSlot>} */
  const byStart = new Map();
  /** @type {Record<string, string>} */
  const calendarState = {};
  const padded = { from: new Date(range.from.getTime() - service.bufferBeforeMinutes * 60_000), to: new Date(range.to.getTime() + service.bufferAfterMinutes * 60_000) };
  for (const c of candidates) {
    const cal = await calendarBusyFor({ id: c.id, email: c.email }, padded, calendar);
    calendarState[c.id] = cal.state === 'UNAVAILABLE' ? `UNAVAILABLE:${cal.reason}` : cal.state;
    if (cal.state === 'UNAVAILABLE') continue;   // a required calendar check that cannot be made: none of this professional's slots is offered (fail safe)
    const own = hours.get(c.id);
    const windows = own ? memberWindows(own, padded) : { allow: null, block: [] };
    const busy = [...busyOf(c.id, appointments, offs), ...windows.block, ...(cal.state === 'OK' ? cal.busy : [])];
    const slots = generateSlots({ rules, from: range.from, to: range.to, durationMinutes: service.durationMinutes, bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes, busyWindows: busy, maxSlots: 800 })
      .filter((s) => allowedBy({ allow: windows.allow, block: [] }, new Date(s.startAt), new Date(s.endAt))).filter(accept);
    for (const s of slots) {
      const cur = byStart.get(s.startAt);
      if (cur) cur.pros.push(c.id); else byStart.set(s.startAt, { startAt: s.startAt, endAt: s.endAt, pros: [c.id] });
    }
  }
  return { rules, slots: [...byStart.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)), calendar: calendarState };
}

/**
 * Under the booking locks (the caller holds them, in its transaction): the first of the candidates who is free for [startAt, endAt] in the database's
 * current state — least booked that Paris day first for a no-preference request, else the given order. null when nobody is.
 * @param {Runner} tx @param {{ structureId: string, service: ServiceLike, startAt: Date, endAt: Date, candidates: Candidate[], leastBookedFirst: boolean, exceptId?: string | null }} input
 * @returns {Promise<string | null>}
 */
export async function pickFreeUnderLock(tx, { structureId, service, startAt, endAt, candidates, leastBookedFirst, exceptId = null }) {
  const day = { from: plusDays(startAt, -1), to: plusDays(endAt, 1) };
  const [appointments, offs, hours] = await Promise.all([activeAppointments(tx, structureId, day, exceptId), timeOffs(tx, structureId, candidates.map((c) => c.id), { from: startAt, to: endAt }),
    readMemberHours(structureId, candidates.map((c) => c.id), tx)]);
  const parisDay = (/** @type {Date} */ d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
  const sameDay = parisDay(startAt);
  const load = (/** @type {string} */ id) => appointments.filter((a) => a.pro === id && parisDay(a.startAt) === sameDay).length;
  const ordered = leastBookedFirst ? [...candidates].sort((a, b) => load(a.id) - load(b.id) || a.id.localeCompare(b.id)) : candidates;
  const want = { start: new Date(startAt.getTime() - service.bufferBeforeMinutes * 60_000), end: new Date(endAt.getTime() + service.bufferAfterMinutes * 60_000) };
  for (const c of ordered) {
    if (busyOf(c.id, appointments, offs).some((w) => want.start < w.end && w.start < want.end)) continue;
    // R42-CDGG: the member's own hours, re-read under the lock (a change of hours between the slot list and the booking is honoured)
    const own = hours.get(c.id);
    if (own) {
      const w = memberWindows(own, day);
      if (w.block.some((b) => want.start < b.end && b.start < want.end) || !allowedBy({ allow: w.allow, block: [] }, startAt, endAt)) continue;
    }
    return c.id;
  }
  return null;
}

/**
 * The candidates whose connected calendar (if any) is checkable and free over the slot with its buffers — the external check, made BEFORE the locks.
 * @param {Candidate[]} candidates @param {ServiceLike} service @param {Date} startAt @param {Date} endAt @param {import('./rdv-calendar-busy.js').CalendarOptions} [calendar]
 */
export async function calendarFree(candidates, service, startAt, endAt, calendar = {}) {
  const want = { from: new Date(startAt.getTime() - service.bufferBeforeMinutes * 60_000), to: new Date(endAt.getTime() + service.bufferAfterMinutes * 60_000) };
  /** @type {Candidate[]} */
  const out = [];
  for (const c of candidates) {
    const cal = await calendarBusyFor({ id: c.id, email: c.email }, want, calendar);
    if (cal.state === 'UNAVAILABLE') continue;
    if (cal.state === 'OK' && cal.busy.some((w) => want.from < w.end && w.start < want.to)) continue;
    out.push(c);
  }
  return out;
}
