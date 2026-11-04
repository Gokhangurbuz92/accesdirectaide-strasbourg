/**
 * R43 (dossier RGPD § 2.1, gap E6) — the explicit consent to transmit the optional booking message to the structure, and its withdrawal.
 * One append-only ConsentLog row per decision (purpose BOOKING_MESSAGE_TRANSMISSION, subject = the account, the appointment id in policy_hash — the
 * ledger has no appointment column and 0042 gets no migration); the wording version in policy_version. Never the message text.
 * Withdrawal (the person, before the appointment): ProAppointment.notes of THEIR citizen booking set to NULL (compare-and-set on the owner), then a
 * decision false row. Same 404 for someone else's appointment and an unknown id.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ConsentLog, ProAppointment } from '../../src/db/schema.js';
import { BOOKING_MESSAGE_CONSENT_PURPOSE, BOOKING_MESSAGE_CONSENT_VERSION } from '../_utils/rdv-message.js';

/** @param {string} userId @param {string} appointmentId @param {boolean} decision @param {any} [dbh] @param {string} [channel] */
export async function recordMessageConsent(userId, appointmentId, decision, dbh = defaultDb, channel = 'booking') {
  await dbh.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER',
    subject_id: String(userId),
    purpose: BOOKING_MESSAGE_CONSENT_PURPOSE,
    decision: decision === true,
    policy_version: BOOKING_MESSAGE_CONSENT_VERSION,
    policy_hash: `${BOOKING_MESSAGE_CONSENT_VERSION}:${BOOKING_MESSAGE_CONSENT_PURPOSE}:${appointmentId}`,
    collection_channel: channel,
    guardian_involved: false,
    proof_level: 'EXPLICIT_CHECKBOX',
    ...(decision === true ? {} : { withdrawn_at: new Date() }),
  });
}

/**
 * The person withdraws (erases) the message of their own appointment before it starts.
 * @param {string} userId @param {string} appointmentId @param {{ database?: any, now?: Date }} [deps]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function withdrawBookingMessage(userId, appointmentId, deps = {}) {
  const database = deps.database ?? defaultDb;
  const now = deps.now ?? new Date();
  const [row] = await database.select({ id: ProAppointment.id, citizenUserId: ProAppointment.citizenUserId, startAt: ProAppointment.startAt, hasNotes: isNotNull(ProAppointment.notes) })
    .from(ProAppointment).where(eq(ProAppointment.id, appointmentId)).limit(1);
  if (!row || row.citizenUserId !== userId) return { status: 404, body: { error: 'Appointment not found' } };
  if (!row.hasNotes) return { status: 409, body: { error: 'NO_MESSAGE', code: 'NO_MESSAGE', message: 'Ce rendez-vous n’a pas de message.' } };
  if (new Date(row.startAt).getTime() <= now.getTime()) return { status: 409, body: { error: 'MESSAGE_WITHDRAWAL_TOO_LATE', code: 'MESSAGE_WITHDRAWAL_TOO_LATE', message: 'Le rendez-vous a commencé : le message ne peut plus être retiré ici. Vous pouvez demander son effacement depuis votre espace (vos droits).' } };
  const erased = await database.transaction(async (/** @type {any} */ tx) => {
    const done = await tx.update(ProAppointment).set({ notes: null })
      .where(and(eq(ProAppointment.id, row.id), eq(ProAppointment.citizenUserId, userId), isNotNull(ProAppointment.notes))).returning({ id: ProAppointment.id });
    if (done.length) await recordMessageConsent(userId, row.id, false, tx, 'account');
    return done.length;
  });
  if (!erased) return { status: 409, body: { error: 'NO_MESSAGE', code: 'NO_MESSAGE', message: 'Ce rendez-vous n’a pas de message.' } };
  return { status: 200, body: { ok: true, id: row.id, hasMessage: false } };
}
