/**
 * R43 (dossier RGPD § 2.1, gap E6) — the explicit consent to transmit the optional booking message to the structure, and its withdrawal.
 * One append-only ConsentLog row per decision (purpose BOOKING_MESSAGE_TRANSMISSION, subject = the account, the appointment id in policy_hash — the
 * ledger has no appointment column and 0042 gets no migration); the wording version in policy_version. Never the message text.
 *
 * R45 (ENG-LR-1, D3 v2 [PROPOSITION], GDPR art. 7(3) « retrait à tout moment »): the person withdraws at ANY time — before or after the start, and for a
 * past, cancelled, refused or expired appointment — as long as the message is still in active storage. Withdrawal = ProAppointment.notes of THEIR citizen
 * booking set to NULL (compare-and-set on the owner; the appointment itself stays), then a decision false row (the minimal evidence). Same 404 for someone
 * else's appointment and an unknown id. The structure's members get an in-app notice « message retiré par la personne » WITHOUT content and without e-mail
 * (catalogue event rdv_message_withdrawn, e-mailable: false). What the structure already read or copied into its own records is under its own responsibility
 * (separate controller): the answer says so and promises nothing about partner copies.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ConsentLog, ProAppointment } from '../../src/db/schema.js';
import { BOOKING_MESSAGE_CONSENT_PURPOSE, BOOKING_MESSAGE_CONSENT_VERSION } from '../_utils/rdv-message.js';
import logger from '../_utils/logger.js';

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

const NO_MESSAGE = Object.freeze({ status: 409, body: Object.freeze({ error: 'NO_MESSAGE', code: 'NO_MESSAGE', message: 'Ce rendez-vous n’a pas de message.' }) });

/** what the withdrawal covers, said to the person (the interface shows the same in their language) */
export const WITHDRAWAL_SCOPE = Object.freeze({
  platformCopy: 'ERASED',
  structureCopies: 'STRUCTURE_RESPONSIBILITY',
  message: 'Votre message est effacé de la plateforme : la structure ne peut plus le lire ici. Ce qu’elle a déjà lu ou reporté dans ses propres dossiers relève de sa responsabilité ; vous pouvez lui demander directement de l’effacer.',
});

/**
 * The person withdraws (erases) the message of their own appointment, at any time.
 * @param {string} userId @param {string} appointmentId @param {{ database?: any, notify?: (input: any) => Promise<unknown> }} [deps]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function withdrawBookingMessage(userId, appointmentId, deps = {}) {
  const database = deps.database ?? defaultDb;
  const [row] = await database.select({ id: ProAppointment.id, citizenUserId: ProAppointment.citizenUserId, structureId: ProAppointment.structureId, hasNotes: isNotNull(ProAppointment.notes) })
    .from(ProAppointment).where(eq(ProAppointment.id, appointmentId)).limit(1);
  if (!row || !row.citizenUserId || row.citizenUserId !== userId) return { status: 404, body: { error: 'Appointment not found' } };
  if (!row.hasNotes) return NO_MESSAGE;
  const erased = await database.transaction(async (/** @type {any} */ tx) => {
    const done = await tx.update(ProAppointment).set({ notes: null })
      .where(and(eq(ProAppointment.id, row.id), eq(ProAppointment.citizenUserId, userId), isNotNull(ProAppointment.notes))).returning({ id: ProAppointment.id });
    if (done.length) await recordMessageConsent(userId, row.id, false, tx, 'account');
    return done.length;
  });
  if (!erased) return NO_MESSAGE;
  // the structure's authorised workflow is told that the message is gone — no content, no e-mail, no name; best effort (the erasure is already committed)
  try {
    const notify = deps.notify ?? (await import('./pro-notifications.js')).notify;
    await notify({ structureId: row.structureId, to: 'members', type: 'rdv_message_withdrawn', title: 'Message retiré par la personne',
      message: 'La personne a retiré le message joint à un rendez-vous : il est effacé de la plateforme. Si vous en aviez reporté le contenu dans vos propres dossiers, il vous appartient de décider de son sort au titre de votre propre traitement ; la personne peut vous le demander.',
      metadata: { appointmentId: row.id, kind: 'MESSAGE_WITHDRAWN' } }, { db: database });
  } catch (error) {
    logger.warn({ err: { name: /** @type {any} */ (error)?.name } }, '[rdv] message withdrawal notice not recorded');
  }
  return { status: 200, body: { ok: true, id: row.id, hasMessage: false, withdrawal: WITHDRAWAL_SCOPE } };
}
