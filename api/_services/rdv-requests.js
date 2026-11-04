/**
 * R42 (owner decision R42-A03, Mode B) — the structure accepts or refuses an appointment REQUEST from its agenda.
 *
 *   PATCH /api/pro/appointments { id, decision: 'ACCEPT' | 'REFUSE', reasonCode?: 'NOT_SUITABLE' | 'NO_CAPACITY' | 'OTHER' }
 *
 * Rules: only a request of THIS structure (another one's = the same 404 as an unknown id); only while it is pending (status 'requested') and before its
 * start — a request whose start has passed is marked 'expired' instead (it was never confirmed). Who decides: the professional it is assigned to, an
 * administrator, or a member allowed to manage the schedule (an unassigned request: any active member). A compare-and-set on the status means a
 * cancellation by the person in between is never overwritten. Every decision is journaled (AuditLog: action, appointment id, reason code — no free
 * text, no personal data). The person is told with a neutral subject; an accepted request gets its calendar file. The refusal reason is a fixed code
 * shown with a fixed sentence (no staff free text reaches the person).
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import logger from '../_utils/logger.js';
import { db as defaultDb } from '../../src/db/index.js';
import { ProAppointment } from '../../src/db/schema.js';
import { AUTH_ROLE, logProAudit } from '../_utils/auth.js';
import { canManageSchedule } from '../_utils/schedule-permissions.js';
import { formatParis, noticeCitizen } from './appointment-notices.js';

export const DECISIONS = Object.freeze(['ACCEPT', 'REFUSE']);
export const REFUSAL_REASONS = Object.freeze({
  NOT_SUITABLE: 'La structure indique que cette demande ne relève pas de ses services. Vous pouvez chercher une autre structure dans l’annuaire.',
  NO_CAPACITY: 'La structure ne peut pas recevoir cette demande à ce créneau. Vous pouvez demander un autre créneau.',
  OTHER: 'La structure ne peut pas donner suite à cette demande. Vous pouvez la contacter pour en savoir plus.',
});

/** @typedef {{ structureId: string, userId: string, role: string }} ProCtx */
/** @typedef {{ status: number, body: Record<string, unknown> }} Outcome */

/**
 * @param {ProCtx} proCtx
 * @param {{ id: string, decision: unknown, reasonCode?: unknown, expectedStartAt?: unknown, ip?: string | null }} input
 * @param {{ database?: typeof defaultDb, now?: Date }} [deps]
 * @returns {Promise<Outcome & { appointmentId?: string }>}
 */
export async function decideRequest(proCtx, { id, decision, reasonCode, expectedStartAt, ip = null }, deps = {}) {
  const database = deps.database ?? defaultDb;
  const now = deps.now ?? new Date();
  if (decision !== 'ACCEPT' && decision !== 'REFUSE') return { status: 400, body: { error: 'INVALID_DECISION', code: 'INVALID_DECISION', message: 'decision doit valoir ACCEPT ou REFUSE.' } };
  const reason = decision === 'REFUSE' ? (typeof reasonCode === 'string' && reasonCode in REFUSAL_REASONS ? /** @type {keyof typeof REFUSAL_REASONS} */ (reasonCode) : 'OTHER') : null;
  const [row] = await database.select({ id: ProAppointment.id, structureId: ProAppointment.structureId, status: ProAppointment.status, startAt: ProAppointment.startAt,
    endAt: ProAppointment.endAt, citizenUserId: ProAppointment.citizenUserId, pro: ProAppointment.createdByProUserId, rescheduleCount: ProAppointment.rescheduleCount, mode: ProAppointment.mode })
    .from(ProAppointment).where(eq(ProAppointment.id, id)).limit(1);
  if (!row || row.structureId !== proCtx.structureId) return { status: 404, body: { error: 'Appointment not found' } };
  // R43 (E4): a request already written `expired` (at its start, when the person or the agenda looked) answers as expired, like a late decision
  if (row.status === 'expired') return { status: 409, body: { error: 'REQUEST_EXPIRED', code: 'REQUEST_EXPIRED', message: 'L’heure de cette demande est passée : elle a expiré sans être confirmée.' } };
  if (row.status !== 'requested') return { status: 409, body: { error: 'REQUEST_NOT_PENDING', code: 'REQUEST_NOT_PENDING', message: 'Cette demande n’est plus en attente : rechargez l’agenda.' } };
  const allowed = !row.pro || row.pro === proCtx.userId || proCtx.role === AUTH_ROLE.STRUCTURE_ADMIN || proCtx.role === AUTH_ROLE.SUPERADMIN || (await canManageSchedule(proCtx));
  if (!allowed) return { status: 403, body: { error: 'FORBIDDEN', code: 'REQUEST_DECISION_FORBIDDEN', message: 'Seuls la personne concernée, l’administrateur ou un membre chargé du planning peuvent répondre à cette demande.' } };

  if (new Date(row.startAt).getTime() <= now.getTime()) {
    const expired = await database.update(ProAppointment).set({ status: 'expired' })
      .where(and(eq(ProAppointment.id, row.id), eq(ProAppointment.status, 'requested'))).returning({ id: ProAppointment.id });
    if (expired.length) await logProAudit('RDV_REQUEST_EXPIRED', proCtx.userId, proCtx.structureId, { appointmentId: row.id }, ip);
    return { status: 409, body: { error: 'REQUEST_EXPIRED', code: 'REQUEST_EXPIRED', message: 'L’heure de cette demande est passée : elle a expiré sans être confirmée.' } };
  }

  // R43: the time the team decided on. A request the person moved after the agenda was loaded is not confirmed at a time nobody saw (reload first).
  const seen = typeof expectedStartAt === 'string' && expectedStartAt ? new Date(expectedStartAt) : null;
  if (seen && (Number.isNaN(seen.getTime()) || seen.getTime() !== new Date(row.startAt).getTime())) {
    return { status: 409, body: { error: 'APPOINTMENT_CHANGED', code: 'APPOINTMENT_CHANGED', message: 'Cette demande vient d’être modifiée : rechargez l’agenda.' } };
  }
  const next = decision === 'ACCEPT' ? 'confirmed' : 'refused';
  const written = await database.update(ProAppointment).set({ status: next })
    .where(and(eq(ProAppointment.id, row.id), eq(ProAppointment.structureId, proCtx.structureId), eq(ProAppointment.status, 'requested'))).returning({ id: ProAppointment.id });
  if (!written.length) return { status: 409, body: { error: 'APPOINTMENT_CHANGED', code: 'APPOINTMENT_CHANGED', message: 'Cette demande vient d’être modifiée : rechargez l’agenda.' } };
  await logProAudit(decision === 'ACCEPT' ? 'RDV_REQUEST_ACCEPTED' : 'RDV_REQUEST_REFUSED', proCtx.userId, proCtx.structureId, { appointmentId: row.id, reasonCode: reason }, ip);

  const when = formatParis(row.startAt);
  const appointment = { id: row.id, structureId: row.structureId, citizenUserId: row.citizenUserId };
  const mail = decision === 'ACCEPT'
    ? await noticeCitizen(appointment, 'REQUEST_ACCEPTED', {
      subject: 'Votre rendez-vous est confirmé - Accès Direct Aide',
      text: `Votre demande de rendez-vous du ${when} (Europe/Paris) est acceptée : le rendez-vous est confirmé.\n\nLe détail (lieu, modalité, annulation) est dans Mes rendez-vous.`,
      calendar: { appointmentId: row.id, startAt: row.startAt, endAt: row.endAt, structureName: 'Rendez-vous Accès Direct Aide', serviceName: 'Rendez-vous', sequence: Number(row.rescheduleCount || 0) },
    }, { db: database })
    : await noticeCitizen(appointment, 'REQUEST_REFUSED', {
      subject: 'Réponse à votre demande de rendez-vous - Accès Direct Aide',
      text: `Votre demande de rendez-vous du ${when} (Europe/Paris) n’est pas acceptée. Le créneau est libéré.\n\n${REFUSAL_REASONS[/** @type {keyof typeof REFUSAL_REASONS} */ (reason)]}`,
    }, { db: database });
  return { status: 200, body: { ok: true, id: row.id, status: next, notification: { citizenEmail: String(mail) } }, appointmentId: row.id };
}

/**
 * R43 (dossier RGPD E4) — an unanswered Mode B request whose start has passed is written `expired` (the status R42 already uses; ProAppointment.status
 * is free text on 0042: no CHECK, no migration). No job runs in Production, so the write happens where the request is next seen: the person's list /
 * detail and the structure's agenda (and, as before, a late decision). Compare-and-set on the status: an accept / refuse / cancel that wins the race
 * is never overwritten. Scoped to ONE structure or ONE person; returns the number of rows expired; never throws (a failed write only delays it — the
 * person already sees EXPIRED from the start time on, appointmentState()). Account requests only (citizenUserId set): a LAB 0044 guest hold is left alone.
 * @param {{ structureId?: string, citizenUserId?: string }} scope @param {{ database?: typeof defaultDb, now?: Date }} [deps]
 */
export async function expireStaleRequests(scope, deps = {}) {
  const database = deps.database ?? defaultDb;
  const now = deps.now ?? new Date();
  const where = scope.structureId ? eq(ProAppointment.structureId, scope.structureId) : scope.citizenUserId ? eq(ProAppointment.citizenUserId, scope.citizenUserId) : null;
  if (!where) return 0;
  try {
    const rows = await database.update(ProAppointment).set({ status: 'expired' })
      .where(and(where, isNotNull(ProAppointment.citizenUserId), eq(ProAppointment.status, 'requested'), lte(ProAppointment.startAt, now))).returning({ id: ProAppointment.id });
    if (rows.length) logger.info({ expired: rows.length }, '[rdv-requests] unanswered requests expired at their start');
    return rows.length;
  } catch (error) {
    logger.warn({ err: { name: error instanceof Error ? error.name : 'Error' } }, '[rdv-requests] expiry write failed');
    return 0;
  }
}
