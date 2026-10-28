// @ts-nocheck
/**
 * PKG-3 / B04-B06 — notices about an appointment, to the person and to the structure, with an honest ledger (AppointmentNotice).
 * The person: an e-mail only to the VERIFIED account e-mail of the appointment, and only through a channel the person allows (canNotify: 'service' for a change they did not
 * make or a confirmation of their own change, 'reminder' for J-1). Without an account there is nobody to write to (NO_RECIPIENT) — a typed phone number is never used here.
 * The structure: an in-app notice to each active member, and an e-mail to those who keep e-mail notifications on. Messages carry the date and the kind of change only —
 * no beneficiary name, no notes. The ledger stores the outcome per recipient/channel, never the text or an address.
 */
import { and, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AppointmentNotice, CitizenUser } from '../../src/db/schema.js';
import { mailLedgerStatus, sendMail as defaultSendMail } from '../_utils/mailer.js';
import { env } from '../_utils/env.js';
import { buildAppointmentIcs, calendarContentType } from '../_utils/ics.js';
import { canNotify as defaultCanNotify } from './citizen-account.js';
import logger from '../_utils/logger.js';

export const NOTICE_KINDS = ['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED'];
export const formatParis = (d) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(d));
/** PKG-11 audit pass 2: the date and the time of an appointment as a person in Strasbourg reads them (the servers run in UTC: « 08:00 » for a 10:00 summer appointment). */
export const formatParisDate = (d) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date(d));
export const formatParisTime = (d) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(d));
const parisParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date(d)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
/** The UTC instant of 00:00 in Paris on the Paris calendar day (y, m, d) (d may overflow: Date.UTC normalises it). */
function parisMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d); const p = parisParts(guess);
  return new Date(guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess));
}
/** [start, end) of the Paris calendar day `plusDays` after the Paris day of `now` (e.g. 1 = « demain » for a person in Strasbourg). */
export function parisDayWindow(now = new Date(), plusDays = 1) {
  const p = parisParts(now);
  return { start: parisMidnight(p.year, p.month, p.day + plusDays), end: parisMidnight(p.year, p.month, p.day + plusDays + 1) };
}
const MAX_STRUCTURE_RECIPIENTS = 25;

export async function recordNotice(appointmentId, kind, recipient, channel, status, db = defaultDb) {
  try { await db.insert(AppointmentNotice).values({ appointmentId, kind, recipient, channel, status }); }
  catch (err) { logger.warn({ err: { name: err?.name, code: err?.cause?.code || err?.code } }, '[appointment-notices] ledger write failed'); }
}

/**
 * N05 (R13): the calendar file of an e-mail is an iTIP message from the sending address (ORGANIZER) to this recipient (ATTENDEE of a cancellation), with the
 * matching Content-Type `method` — built here because only here is the recipient known. `calendar` = the buildAppointmentIcs input (without `itip`).
 * @param {object} calendar @param {string} to
 */
export function calendarAttachment(calendar, to) {
  const content = buildAppointmentIcs({ ...calendar, itip: { organizer: env.mailer.from, attendee: to } });
  return { filename: `acces-direct-aide-rdv-${calendar.appointmentId}.ics`, contentType: calendarContentType(content), content };
}

/** To the person of the appointment. `category` is 'service' (changes / confirmations) or 'reminder' (J-1). Returns the recorded status. */
export async function noticeCitizen(appointment, kind, message, deps = {}) {
  const db = deps.db || defaultDb; const sendMail = deps.sendMail || defaultSendMail; const canNotify = deps.canNotify || defaultCanNotify;
  const category = kind === 'REMINDER_J1' ? 'reminder' : 'service';
  let status = 'NO_RECIPIENT';
  try {
    if (appointment.citizenUserId) {
      const [u] = await db.select({ email: CitizenUser.email, verified: CitizenUser.emailVerifiedAt }).from(CitizenUser).where(eq(CitizenUser.id, appointment.citizenUserId)).limit(1);
      if (u && u.email && u.verified) {
        if (!(await canNotify(appointment.citizenUserId, 'email', category).catch(() => false))) status = 'NO_CONSENT';
        else {
          const attachments = [...(message.attachments || []), ...(message.calendar ? [calendarAttachment(message.calendar, u.email)] : [])];
          const out = await sendMail({ to: u.email, subject: message.subject, text: message.text, category: `appointment-${kind.toLowerCase()}`, ...(attachments.length ? { attachments } : {}) });
          status = mailLedgerStatus(out);   // PKG-4: the test outbox is TEST_RECORDED, never DELIVERED
        }
      }
    }
  } catch (err) {
    status = 'FAILED'; logger.warn({ err: { name: err?.name } }, '[appointment-notices] citizen notice failed');
  }
  await recordNotice(appointment.id, kind, 'citizen', 'email', status, db);
  return status;
}

/** To the structure of the appointment: in-app notice to every active member, e-mail to members who keep e-mail notifications on. Returns { inApp, email }. */
export async function noticeStructure(appointment, kind, message, deps = {}) {
  const db = deps.db || defaultDb; const sendMail = deps.sendMail || defaultSendMail;
  const result = { inApp: 'NO_RECIPIENT', email: 'NO_RECIPIENT' };
  try {
    // PKG-4 / R20: through the one catalogue (in-app for every active member; e-mail per member preference; outcome never mixed up)
    const { notify } = await import('./pro-notifications.js');
    const sum = await notify({ structureId: appointment.structureId, to: 'members', type: `rdv_${kind.toLowerCase()}`, title: message.title, message: message.text, metadata: { appointmentId: appointment.id, kind } }, { db, sendMail });
    const e = sum.email; const reached = Object.values(e).reduce((a, b) => a + b, 0);
    if (reached) result.inApp = sum.inApp ? 'DELIVERED' : 'FAILED';
    if (reached) result.email = e.PROVIDER_ACCEPTED ? 'PROVIDER_ACCEPTED' : e.TEST_RECORDED ? 'TEST_RECORDED' : (e.NOT_DELIVERED || e.FAILED) ? 'NOT_DELIVERED' : e.OFF_BY_PREFERENCE ? 'NO_CONSENT' : 'NO_RECIPIENT';
  } catch (err) {
    result.inApp = 'FAILED'; logger.warn({ err: { name: err?.name } }, '[appointment-notices] structure notice failed');
  }
  await recordNotice(appointment.id, kind, 'structure', 'in_app', result.inApp, db);
  await recordNotice(appointment.id, kind, 'structure', 'email', result.email, db);
  return result;
}

/** The notices of one appointment, newest first (for the professional view and the tests). */
export async function listNotices(appointmentId, db = defaultDb) {
  return db.select({ kind: AppointmentNotice.kind, recipient: AppointmentNotice.recipient, channel: AppointmentNotice.channel, status: AppointmentNotice.status, at: AppointmentNotice.createdAt })
    .from(AppointmentNotice).where(eq(AppointmentNotice.appointmentId, appointmentId));
}
