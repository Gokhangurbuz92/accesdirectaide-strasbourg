/**
 * R47 — the STRUCTURE moves one of its appointments to another free slot of the same service (« déplacer » in the professional appointment detail).
 *
 *   GET  /api/pro/appointments/reschedule?id=&from=YYYY-MM-DD   the free slots of that appointment's professional (14 days from `from`, inside the booking window)
 *   POST /api/pro/appointments/reschedule { id, startAt, expectedStartAt?, sensitiveConsent? }
 *
 * Rules (the same as a booking, where they apply to the team):
 *   - only an appointment of THIS structure (another one's = the same 404 as an unknown id); who: the professional it is assigned to, an unassigned one any
 *     active member, an administrator or a member delegated to manage the schedule (api/_utils/schedule-permissions.js) — the rule of a request decision;
 *   - only an ACTIVE appointment still to come (booked / confirmed); a pending REQUEST of an approval-required service is answered first (accept or
 *     refuse) — the team never confirms a time the person did not ask for by moving it; a moved confirmed appointment of an approval-required service
 *     stays confirmed (the structure is the one that approves); `expectedStartAt` = the time the screen showed (a change in between → 409, reload);
 *   - the new slot: the 60-day booking window and the minimum delay; the structure's hours for the modality kept; the assigned professional's own hours,
 *     absences and connected calendar (team choice), else the structure's agenda plus that professional's absences; closures; the active appointments
 *     with their buffers — re-checked under the SAME locks as a booking (in-process FIFO + PostgreSQL advisory lock of the structure / Paris day of both
 *     the old and the new day, rdv.js moveSlot), on the row itself;
 *   - the service's CURRENT verified sensitivity (as a citizen's own move, R46): refused while the art. 9 gate is closed (or unreviewed where the review is
 *     enforced); with the gate open, the person's active explicit consent for THIS appointment is required (a team cannot give it for an account
 *     holder); for an appointment the team created for a person, the professional records that the person agreed (as when creating it);
 *   - the modality is kept; the person's own move allowance (D-2, rescheduleCount) is not used up; the J-1 reminder is re-armed.
 * Recorded: the appointment row (new time), the journal (AuditLog RDV_PRO_RESCHEDULED: appointment id, structure id — no time, no name, no free text),
 * the notice ledger. The person is told through the notice path (privacy level R45: the neutral minimal message unless the service is verified ordinary;
 * the in-app item « Un rendez-vous a été déplacé »); the team gets its in-app notice.
 */
import { and, count, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProRdvService, ProTimeOff } from '../../src/db/schema.js';
import { AUTH_ROLE, logProAudit } from '../_utils/auth.js';
import { canManageSchedule } from '../_utils/schedule-permissions.js';
import { appointmentTable, flagsOf, requestGuestSchema } from '../_utils/schema-features.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { modeLabel } from '../lib/appointment-modes.js';
import { SENSITIVITY_CODES, bookingDecision } from '../lib/service-sensitivity.js';
import { readServiceSensitivity } from './service-sensitivity-review.js';
import { readBookingConfig } from './rdv-booking-config.js';
import { formatParis, noticeCitizen, noticeStructure } from './appointment-notices.js';
import { TEAM_MOVE_ACTION } from './rdv-team-moves.js';

export const MOVABLE_STATUSES = Object.freeze(['booked', 'confirmed']);
const NOT_FOUND = Object.freeze({ status: 404, body: { error: 'Appointment not found' } });
const SLOT_TAKEN = Object.freeze({ error: 'Slot no longer available', code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre. Choisissez-en un autre.' });
const DAY = 86_400_000;

/** @typedef {{ structureId: string, userId: string, role: string }} ProCtx */
/** @typedef {{ status: number, body: Record<string, unknown> }} Outcome */

/**
 * Why this appointment cannot be moved by the team now (null = it can). Pure: used before and again under the locks, on the locked row.
 * @param {{ status?: string | null, startAt: Date | string, guestHoldExpiresAt?: Date | string | null }} row @param {{ now?: Date, expectedStartAt?: unknown }} [opts]
 * @returns {Outcome | null}
 */
export function proMoveRefusal(row, { now = new Date(), expectedStartAt } = {}) {
  const status = String(row.status || '').toLowerCase();
  if (status === 'requested') return { status: 409, body: { error: 'REQUEST_PENDING', code: 'REQUEST_PENDING', message: 'Cette demande attend une réponse : acceptez-la ou refusez-la d’abord. La personne peut aussi demander un autre créneau.' } };
  if (!MOVABLE_STATUSES.includes(status) || row.guestHoldExpiresAt) return { status: 409, body: { error: 'APPOINTMENT_NOT_ACTIVE', code: 'APPOINTMENT_NOT_ACTIVE', message: 'Ce rendez-vous n’est plus actif : il ne peut pas être déplacé.' } };
  if (new Date(row.startAt).getTime() <= now.getTime()) return { status: 409, body: { error: 'APPOINTMENT_STARTED', code: 'APPOINTMENT_STARTED', message: 'Ce rendez-vous a déjà commencé : il ne peut plus être déplacé.' } };
  if (typeof expectedStartAt === 'string' && expectedStartAt) {
    const seen = new Date(expectedStartAt);
    if (Number.isNaN(seen.getTime()) || seen.getTime() !== new Date(row.startAt).getTime()) return { status: 409, body: { error: 'APPOINTMENT_CHANGED', code: 'APPOINTMENT_CHANGED', message: 'Ce rendez-vous vient d’être modifié : rechargez la page.' } };
  }
  return null;
}

/** the UTC day [start, end] of an instant (the citizen reschedule's check range) @param {Date} d */
const utcDay = (d) => ({ from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)) });

/**
 * The appointment, its service and its structure for a team move, or the refusal. Tenant check first (no existence oracle), then who may move it.
 * @param {ProCtx} proCtx @param {string} id @param {typeof defaultDb} database
 */
async function loadForMove(proCtx, id, database) {
  const T = appointmentTable(await requestGuestSchema(database));
  const appointment = id ? await database.query.ProAppointment.findFirst({ columns: flagsOf(T), where: (pa, { eq: e }) => e(pa.id, id) }) : null;
  if (!appointment || appointment.structureId !== proCtx.structureId) return { refusal: NOT_FOUND };
  const pro = appointment.createdByProUserId || null;
  const allowed = !pro || pro === proCtx.userId || proCtx.role === AUTH_ROLE.STRUCTURE_ADMIN || proCtx.role === AUTH_ROLE.SUPERADMIN || (await canManageSchedule(proCtx, database));
  if (!allowed) return { refusal: { status: 403, body: { error: 'FORBIDDEN', code: 'RESCHEDULE_FORBIDDEN', message: 'Seuls la personne qui suit ce rendez-vous, l’administrateur ou un membre chargé du planning peuvent le déplacer.' } } };
  const [service] = appointment.serviceId ? await database.select({ id: ProRdvService.id, name: ProRdvService.name, structureId: ProRdvService.structureId, durationMinutes: ProRdvService.durationMinutes,
    bufferBeforeMinutes: ProRdvService.bufferBeforeMinutes, bufferAfterMinutes: ProRdvService.bufferAfterMinutes, isActive: ProRdvService.isActive })
    .from(ProRdvService).where(and(eq(ProRdvService.id, appointment.serviceId), eq(ProRdvService.structureId, proCtx.structureId))).limit(1) : [];
  if (!service || !service.isActive) return { refusal: { status: 409, body: { error: 'SERVICE_INACTIVE', code: 'SERVICE_INACTIVE', message: 'Le service de ce rendez-vous n’est plus proposé : il ne peut pas être déplacé en ligne.' } } };
  return { appointment, service, structure: { id: proCtx.structureId } };
}

/**
 * Whose availability the new slot must respect: the assigned professional's own (team choice, they take bookings for the service) or the structure's agenda.
 * @param {{ id: string }} structure @param {any} service @param {any} appointment
 * @returns {Promise<{ kind: 'TEAM', candidates: import('./rdv-team.js').Candidate[] } | { kind: 'STRUCTURE', pro: string | null }>}
 */
export async function movePlan(structure, service, appointment) {
  const pro = appointment.createdByProUserId || null;
  const config = await readBookingConfig(structure.id);
  if (config.team.enabled && pro) {
    const team = await import('./rdv-team.js');
    const assigned = (await team.candidatesFor(structure.id, service.id, config)).filter((c) => c.id === pro);
    if (assigned.length) return { kind: 'TEAM', candidates: assigned };
  }
  return { kind: 'STRUCTURE', pro };
}

/** the absences of one member over a range (the structure path: the assigned professional's own absences also block) */
async function memberAbsences(/** @type {any} */ runner, /** @type {string} */ structureId, /** @type {string} */ pro, /** @type {{ from: Date, to: Date }} */ range) {
  return runner.select({ start: ProTimeOff.startAt, end: ProTimeOff.endAt }).from(ProTimeOff)
    .where(and(eq(ProTimeOff.structureId, structureId), eq(ProTimeOff.proUserId, pro), lt(ProTimeOff.startAt, range.to), gt(ProTimeOff.endAt, range.from)));
}

/**
 * The free slots of this appointment's professional over a range, inside the booking window, the appointment itself not counted.
 * @param {{ structure: { id: string }, service: any, appointment: any, range: { from: Date, to: Date } }} input
 * @returns {Promise<Array<{ startAt: string, endAt: string }>>}
 */
export async function slotsForMove({ structure, service, appointment, range }) {
  const rdv = await import('../_handlers/rdv.js');
  const mode = appointment.mode || 'IN_PERSON';
  const plan = await movePlan(structure, service, appointment);
  if (plan.kind === 'TEAM') {
    const team = await import('./rdv-team.js');
    const out = await team.teamSlots({ structure, service, mode, range, candidates: plan.candidates, exceptId: appointment.id, accept: rdv.withinBookingWindow });
    return out.slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt }));
  }
  const { slots } = await rdv.computePublicSlots(structure, service, mode, range, { exceptId: appointment.id });
  if (!plan.pro) return slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt }));
  /** @type {Array<{ start: Date, end: Date }>} */
  const offs = await memberAbsences(defaultDb, structure.id, plan.pro, range);
  return slots.filter((s) => !offs.some((/** @type {{ start: Date, end: Date }} */ o) => new Date(s.startAt) < o.end && o.start < new Date(s.endAt))).map((s) => ({ startAt: s.startAt, endAt: s.endAt }));
}

/** what the art. 9 gate asks for this move (null = nothing more) @param {any} appointment @param {any} service @param {unknown} attested @returns {Promise<Outcome | null>} */
async function sensitivityRefusalForMove(appointment, service, attested) {
  const gate = bookingDecision(await readServiceSensitivity(appointment.structureId, service.id));
  if (!gate.allowed) {
    return { status: 409, body: { error: gate.code, code: gate.code, message: 'Ce service n’est pas ouvert à la prise de rendez-vous sur la plateforme (service sensible, ou classification pas encore revue par ADA) : ce rendez-vous ne peut pas être déplacé ici. Contactez la personne par vos moyens habituels.' } };
  }
  if (!gate.requiresConsent) return null;
  if (appointment.citizenUserId) {
    const consent = await import('./sensitive-booking-consent.js');
    if (await consent.hasActiveSensitiveConsent(appointment.citizenUserId, appointment.id)) return null;
    return { status: 409, body: { error: 'SENSITIVE_CONSENT_MISSING', code: 'SENSITIVE_CONSENT_MISSING', message: 'La personne n’a pas donné, pour ce rendez-vous, l’accord explicite que ce service demande : elle peut le déplacer elle-même depuis son espace, ou vous pouvez convenir d’une autre date avec elle.' } };
  }
  return attested === true ? null : { status: 400, body: { error: SENSITIVITY_CODES.CONSENT_REQUIRED, code: SENSITIVITY_CODES.CONSENT_REQUIRED, message: 'Confirmez que la personne a donné son accord explicite, en connaissant la nature de ce service.' } };
}

/**
 * GET — the free slots for this appointment over 14 days from `from` (the screen pages through the 60-day window).
 * @param {ProCtx} proCtx @param {{ id: string, from?: unknown }} input @param {{ database?: typeof defaultDb, now?: Date }} [deps] @returns {Promise<Outcome>}
 */
export async function moveOptions(proCtx, { id, from }, deps = {}) {
  const database = deps.database ?? defaultDb; const now = deps.now ?? new Date();
  const loaded = await loadForMove(proCtx, id, database);
  if ('refusal' in loaded) return /** @type {Outcome} */ (loaded.refusal);
  const { appointment, service, structure } = loaded;
  const refused = proMoveRefusal(appointment, { now });
  if (refused) return refused;
  const rdv = await import('../_handlers/rdv.js');
  const today = utcDay(now).from;
  const last = new Date(today.getTime() + rdv.MAX_BOOKING_AHEAD_DAYS * DAY);
  const asked = typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00Z`) : today;
  const start = Number.isNaN(asked.getTime()) || asked < today ? today : asked > last ? last : asked;
  const range = { from: start, to: new Date(Math.min(start.getTime() + 14 * DAY - 1, last.getTime() + DAY - 1)) };
  const slots = (await slotsForMove({ structure, service, appointment, range })).filter((s) => s.startAt !== new Date(appointment.startAt).toISOString());
  const gate = bookingDecision(await readServiceSensitivity(appointment.structureId, service.id));
  return { status: 200, body: { id: appointment.id, startAt: new Date(appointment.startAt).toISOString(), from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10),
    hasPrevious: range.from > today, hasNext: range.to < last, slots,
    // what the screen must ask before a move: nothing, the professional's attestation (appointment created by the team), or not possible online
    consent: !gate.allowed ? 'NOT_OPEN' : gate.requiresConsent ? (appointment.citizenUserId ? 'PERSON' : 'ATTEST') : 'NONE' } };
}

/**
 * POST — move the appointment. Either it moves (and is recorded, journaled, notified) or nothing changes.
 * @param {ProCtx} proCtx @param {{ id: string, startAt: unknown, expectedStartAt?: unknown, sensitiveConsent?: unknown, ip?: string | null }} input
 * @param {{ database?: typeof defaultDb, now?: Date }} [deps] @returns {Promise<Outcome>}
 */
export async function proReschedule(proCtx, { id, startAt: rawStart, expectedStartAt, sensitiveConsent, ip = null }, deps = {}) {
  const database = deps.database ?? defaultDb; const now = deps.now ?? new Date();
  const startAt = new Date(typeof rawStart === 'string' ? rawStart : '');
  if (!id || Number.isNaN(startAt.getTime())) return { status: 400, body: { error: 'INVALID_INPUT', code: 'INVALID_INPUT', message: 'Un rendez-vous et un nouveau créneau valides sont nécessaires.' } };
  const loaded = await loadForMove(proCtx, id, database);
  if ('refusal' in loaded) return /** @type {Outcome} */ (loaded.refusal);
  const { appointment, service, structure } = loaded;
  const early = proMoveRefusal(appointment, { now, expectedStartAt });
  if (early) return early;
  const rdv = await import('../_handlers/rdv.js');
  if (startAt.getTime() < now.getTime() + rdv.MIN_BOOKING_DELAY_MINUTES * 60_000 || startAt.getTime() > now.getTime() + rdv.MAX_BOOKING_AHEAD_DAYS * DAY) {
    return { status: 400, body: { error: 'OUT_OF_WINDOW', code: 'OUT_OF_WINDOW', message: `Le nouveau créneau doit être dans les ${rdv.MAX_BOOKING_AHEAD_DAYS} prochains jours.` } };
  }
  if (startAt.getTime() === new Date(appointment.startAt).getTime()) return { status: 400, body: { error: 'SAME_SLOT', code: 'SAME_SLOT', message: 'Choisissez un autre créneau que l’actuel.' } };
  const sensitive = await sensitivityRefusalForMove(appointment, service, sensitiveConsent);
  if (sensitive) return sensitive;

  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  const plan = await movePlan(structure, service, appointment);
  const offered = await slotsForMove({ structure, service, appointment, range: utcDay(startAt) });
  if (!offered.some((s) => s.startAt === startAt.toISOString() && s.endAt === endAt.toISOString())) return { status: 409, body: { ...SLOT_TAKEN } };
  /** @type {{ counts?: (row: any) => boolean, guard?: (tx: any) => Promise<boolean> }} */
  let lockChecks = {};
  if (plan.kind === 'TEAM') {
    const team = await import('./rdv-team.js');
    if (!(await team.calendarFree(plan.candidates, service, startAt, endAt)).length) return { status: 409, body: { ...SLOT_TAKEN } };
    lockChecks = {
      counts: (row) => !row.createdByProUserId || row.createdByProUserId === appointment.createdByProUserId,
      guard: async (tx) => Boolean(await team.pickFreeUnderLock(tx, { structureId: structure.id, service, startAt, endAt, candidates: plan.candidates, leastBookedFirst: false, exceptId: appointment.id })),
    };
  } else if (plan.pro) {
    const pro = plan.pro;
    lockChecks = { guard: async (tx) => {
      const [off] = await tx.select({ value: count() }).from(ProTimeOff).where(and(eq(ProTimeOff.structureId, structure.id), or(isNull(ProTimeOff.proUserId), eq(ProTimeOff.proUserId, pro)), lt(ProTimeOff.startAt, endAt), gt(ProTimeOff.endAt, startAt)));
      return Number(off?.value || 0) === 0;
    } };
  }
  const { moved, outcome } = await rdv.moveSlot({
    appointment, structure, service, startAt, endAt, personMove: false,
    owns: (row) => row.structureId === proCtx.structureId,
    // under the locks, on the locked row: still active, still to come, still at the time checked above (its instant read by PostgreSQL, whatever the process time zone)
    refuse: (row) => { const r = proMoveRefusal({ status: row.status, startAt: new Date(Number(row.startMs)), guestHoldExpiresAt: appointment.guestHoldExpiresAt }, { now: new Date(), expectedStartAt: new Date(appointment.startAt).toISOString() });
      return r ? { status: r.status, code: r.body.code, error: r.body.message } : null; },
    ...lockChecks,
  });
  if (!moved) return { status: outcome.status, body: outcome.body };

  // journal first: the calendar SEQUENCE of the notice counts this move (api/_services/rdv-team-moves.js)
  await logProAudit(TEAM_MOVE_ACTION, proCtx.userId, proCtx.structureId, { appointmentId: appointment.id }, ip);
  const before = formatParis(appointment.startAt); const after = formatParis(moved.startAt);
  const citizenEmail = await noticeCitizen({ ...moved, guestEmail: appointment.guestEmail ?? null, guestReminderConsentAt: appointment.guestReminderConsentAt ?? null }, 'RESCHEDULED', {
    subject: 'Votre rendez-vous est déplacé - Accès Direct Aide',
    text: `La structure a déplacé votre rendez-vous (${service.name}) :\nancien créneau : ${before}\nnouveau créneau : ${after} (Europe/Paris)\n\nSi le nouvel horaire ne vous convient pas, vous pouvez annuler ou demander un autre créneau : ${buildAppUrl('/compte/rendez-vous')}`,
    calendar: { appointmentId: moved.id, startAt: moved.startAt, endAt: moved.endAt, structureName: 'Rendez-vous Accès Direct Aide', serviceName: service.name, sequence: Number(moved.rescheduleCount || 0) },
  }, { db: database });
  await noticeStructure(moved, 'RESCHEDULED', { title: 'Rendez-vous déplacé par l’équipe', text: `Un rendez-vous a été déplacé par un membre de l’équipe : du ${before} au ${after} (${modeLabel(moved.mode)}).` }, { db: database });
  return { status: 200, body: { ok: true, item: { id: moved.id, status: moved.status, startAt: moved.startAt, endAt: moved.endAt }, notification: { citizenEmail: String(citizenEmail) } } };
}

/**
 * R47 — the journal row of a cancellation by the team (ids and a fixed reason code only). `reasonCode` outside the list is recorded as NOT_GIVEN.
 */
export const CANCEL_REASONS = Object.freeze(['PROFESSIONAL_UNAVAILABLE', 'STRUCTURE_CLOSED', 'PERSON_REQUEST', 'OTHER']);
/** @param {unknown} code */
export const cancelReasonCode = (code) => (typeof code === 'string' && CANCEL_REASONS.includes(code) ? code : 'NOT_GIVEN');
