// @ts-nocheck
/**
 * PKG-3 / B04-B06 — notices about an appointment, to the person and to the structure, with an honest ledger (AppointmentNotice).
 * The person: an e-mail only to the VERIFIED account e-mail of the appointment, and only through a channel the person allows (canNotify: 'service' for a change they did not
 * make or a confirmation of their own change, 'reminder' for J-1). Without an account there is nobody to write to (NO_RECIPIENT) — a typed phone number is never used here —
 * except an account-free booking confirmed by its code (R38: 'service'; R39: 'reminder' only with its separate reminder consent, else NO_CONSENT).
 * The structure: an in-app notice to each active member, and an e-mail to those who keep e-mail notifications on. Messages carry the date and the kind of change only —
 * no beneficiary name, no notes. The ledger stores the outcome per recipient/channel, never the text or an address.
 */
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AppointmentNotice, CitizenUser } from '../../src/db/schema.js';
import { mailLedgerStatus, sendMail as defaultSendMail } from '../_utils/mailer.js';
import { env } from '../_utils/env.js';
import { buildAppointmentIcs, calendarContentType } from '../_utils/ics.js';
import { canNotify as defaultCanNotify } from './citizen-account.js';
import logger from '../_utils/logger.js';
import { guestNoticeDecision } from '../_utils/rdv-guest-core.js';
import { NOTICE_MAIL_KINDS, localizedMail } from '../_utils/mail-catalogue.js';
import { citizenMailLanguage } from './mail-language.js';
import { mailStatusFromSend } from '../lib/mail-status.js';
import { MINIMAL_PATH, minimalMail, resolveNotificationPrivacy, withoutPersonalFreeText } from '../lib/notification-privacy.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { teamMoveCount } from './rdv-team-moves.js';

/**
 * R45 / ENG-LR-3 — the kinds that are NOT notices about an appointment but a code the person asked for (GUEST_CODE: no caller sends it today). They keep
 * their own message at every privacy level: replacing it would remove the code.
 */
export const PRIVACY_EXEMPT_KINDS = Object.freeze(['GUEST_CODE']);

/**
 * R45 / ENG-LR-3 — the e-mail a person receives for one notice, at the privacy level of the appointment (api/lib/notification-privacy.js).
 *   minimal (sensitive or unknown service — the default): the neutral message, no calendar file, no attachment, neutral provider category;
 *   reduced (verified ordinary service): the catalogue subject and opening in the reader's language, the caller's details, the calendar file — never the
 *   booking message nor any free text of the person.
 * @param {object} appointment @param {string} kind @param {{ subject: string, text: string, mailKind?: string, calendar?: object, attachments?: any[] }} message
 * @param {{ lang: string, to: string, guest?: boolean, resolveSensitivity?: (record: unknown) => unknown, db?: any }} opts
 * @returns {Promise<{ level: 'minimal' | 'reduced', subject: string, text: string, html?: string, category: string, attachments: any[] }>}
 */
export async function buildCitizenNoticeMail(appointment, kind, message, opts) {
  const { level } = PRIVACY_EXEMPT_KINDS.includes(kind) ? { level: /** @type {const} */ ('reduced') } : await resolveNotificationPrivacy(appointment, opts);
  if (level === 'minimal') {
    const m = minimalMail(opts.lang, { guest: Boolean(opts.guest), url: buildAppUrl(MINIMAL_PATH) });
    return { level, subject: m.subject, text: m.text, html: m.html, category: m.category, attachments: [] };
  }
  // R47: the calendar SEQUENCE counts the structure's own moves too (api/_services/rdv-team-moves.js), so a later update / cancellation always supersedes
  const calendar = message.calendar ? { ...message.calendar, sequence: Number(message.calendar.sequence || 0) + (opts.db ? await teamMoveCount(message.calendar.appointmentId || appointment.id, opts.db) : 0) } : null;
  const attachments = [...(message.attachments || []), ...(calendar ? [calendarAttachment(calendar, opts.to)] : [])];
  const { subject, text } = localizeNotice(kind, message, opts.lang);
  return { level, subject, text: withoutPersonalFreeText(text, appointment), category: `appointment-${kind.toLowerCase()}`, attachments };
}

/** R44-MAIL: one status-trail row (deps.recordStatus for tests; never throws, never changes what was sent) */
async function trail(noticeId, status, cause, deps) {
  try {
    const write = deps.recordStatus || (await import('./mail-events.js')).recordNoticeStatus;
    await write(noticeId, status, { cause, source: 'notice_send' }, { db: deps.db || defaultDb });
  } catch { /* the trail is evidence, not a condition of the notice */ }
}

/**
 * R43-MAIL — the subject and opening of a citizen notice in the reader's language (stored preference, French otherwise), from the catalogue: neutral,
 * never the caller's subject (which could name a structure or a date). `message.mailKind` overrides the kind's default (a reschedule that is a request
 * again reads as a request). A kind without a catalogue entry (GUEST_CODE) keeps its message as given.
 * @param {string} kind @param {{ subject: string, text: string, mailKind?: string }} message @param {string} lang
 */
export function localizeNotice(kind, message, lang) {
  const mailKind = message.mailKind || NOTICE_MAIL_KINDS[kind];
  if (!mailKind) return { subject: message.subject, text: message.text };
  const out = localizedMail(mailKind, lang, message.text);
  return { subject: out.subject, text: out.text };
}
import { NOTICE_KINDS_0045, noticeLedgerKinds } from '../_utils/schema-features.js';

export const NOTICE_KINDS = ['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED', 'BOOKED_BY_GUEST', 'GUEST_CODE',   // R38: the two account-free kinds
  'BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED'];   // R42 booking kinds (ledger from migration 0045)
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

/**
 * R42: the kinds the ledger table accepts on every database level (its CHECK constraint, migrations 0020 / 0043). They are written as before.
 * R43-E: the four booking kinds (BOOKED_BY_CITIZEN, REQUEST_RECEIVED, REQUEST_ACCEPTED, REQUEST_REFUSED) are accepted only from migration 0045; a writer
 * asks the database (api/_utils/schema-features.js noticeLedgerKinds) and, where 0045 is not applied (Production 0042 until the owner migrates), SKIPS the
 * ledger row and counts it (ledgerSkipCounts) — never recorded under another kind, never a failed write. The notice itself (e-mail, in-app) is sent either way.
 * Any other kind (none today: REQUEST_EXPIRED is a journal action, not a notice) is skipped and counted the same way.
 */
export const LEDGER_KINDS = Object.freeze(['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED', 'BOOKED_BY_GUEST', 'GUEST_CODE']);
export const BOOKING_LEDGER_KINDS = NOTICE_KINDS_0045;
const ledgerSkips = new Map();
/** how many ledger rows this process skipped, per kind and reason (no personal data) @returns {Record<string, number>} */
export function ledgerSkipCounts() { return Object.fromEntries(ledgerSkips); }
function skipLedger(kind, reason) {
  const key = `${kind}:${reason}`; const n = (ledgerSkips.get(key) || 0) + 1; ledgerSkips.set(key, n);
  logger.info({ kind, reason, skipped: n }, '[appointment-notices] ledger row skipped');
}
/** R43-MAIL: `id` (optional) = the row id chosen before the e-mail left, sent as its CustomID « appointment-notice/<id> » so a delivery event finds this row */
export async function recordNotice(appointmentId, kind, recipient, channel, status, db = defaultDb, id = undefined) {
  if (!LEDGER_KINDS.includes(kind)) {
    if (!BOOKING_LEDGER_KINDS.includes(kind)) return skipLedger(kind, 'UNKNOWN_KIND');
    const accepted = await noticeLedgerKinds(db);
    if (!accepted || !accepted.has(kind)) return skipLedger(kind, accepted ? 'MIGRATION_0045_NOT_APPLIED' : 'LEDGER_SCHEMA_UNKNOWN');
  }
  try { await db.insert(AppointmentNotice).values({ ...(id ? { id } : {}), appointmentId, kind, recipient, channel, status }); }
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

/**
 * To the person of the appointment. `category` is 'service' (changes / confirmations) or 'reminder' (J-1). Returns the recorded status.
 * R45 / ENG-LR-3: `deps.resolveSensitivity` (default api/lib/notification-privacy.js defaultResolveSensitivity, () => 'unknown') sets the privacy level.
 */
export async function noticeCitizen(appointment, kind, message, deps = {}) {
  const db = deps.db || defaultDb; const sendMail = deps.sendMail || defaultSendMail; const canNotify = deps.canNotify || defaultCanNotify;
  const category = kind === 'REMINDER_J1' ? 'reminder' : 'service';
  let status = 'NO_RECIPIENT';
  // R43-MAIL: the ledger row id, chosen now: it travels as the message's idempotency key / Mailjet CustomID (api/_services/mail-events.js)
  // R44-MAIL: and as its `correlationId`, which a caller cannot replace — the J-1 reminder replaces the idempotency key with its own stable retry key,
  // and its rows used to miss every delivery event (the CustomID was the reminder key). Each attempt leaves a status trail (api/lib/mail-status.js).
  const noticeId = crypto.randomUUID(); const idempotencyKey = `appointment-notice/${noticeId}`; const correlationId = idempotencyKey;
  let attempted = false;
  const send = async (mail) => {
    attempted = true;
    await trail(noticeId, 'queued', null, deps);
    const out = await sendMail({ ...mail, idempotencyKey, correlationId });
    const fine = mailStatusFromSend(out);
    await trail(noticeId, fine.status, fine.cause, deps);
    return out;
  };
  try {
    if (appointment.citizenUserId) {
      const [u] = await db.select({ email: CitizenUser.email, verified: CitizenUser.emailVerifiedAt }).from(CitizenUser).where(eq(CitizenUser.id, appointment.citizenUserId)).limit(1);
      if (u && u.email && u.verified) {
        if (!(await canNotify(appointment.citizenUserId, 'email', category).catch(() => false))) status = 'NO_CONSENT';
        else {
          // R45 / ENG-LR-3: the privacy level of the appointment decides what the e-mail may say (minimal by default)
          const mail = await buildCitizenNoticeMail(appointment, kind, message, { lang: deps.lang || await citizenMailLanguage(appointment.citizenUserId, db), to: u.email, resolveSensitivity: deps.resolveSensitivity, db });
          const out = await send({ to: u.email, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}), category: mail.category, ...(mail.attachments.length ? { attachments: mail.attachments } : {}) });
          status = mailLedgerStatus(out);   // PKG-4: the test outbox is TEST_RECORDED, never DELIVERED
        }
      }
    } else if (appointment.guestEmail) {
      // R38: an account-free booking — the sealed address it was confirmed with, for 'service' notices (its booking mails, consented at booking).
      // R39: the J-1 reminder only with the separate, optional reminder consent as well (guestReminderConsentAt); without it NO_CONSENT
      const decision = guestNoticeDecision(appointment, category);
      if (decision === 'NO_CONSENT') status = 'NO_CONSENT';
      if (decision === 'SEND') {
        const { decrypt, isV1Text } = await import('../lib/crypto.js');
        const to = isV1Text(appointment.guestEmail) ? decrypt(appointment.guestEmail) : null;
        if (to) {
          // an account-free booking has no stored language: French (R43-MAIL); R45: no account page to sign in to (the minimal text says so)
          const mail = await buildCitizenNoticeMail(appointment, kind, message, { lang: deps.lang || 'fr', to, guest: true, resolveSensitivity: deps.resolveSensitivity, db });
          const out = await send({ to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}), category: mail.category, ...(mail.attachments.length ? { attachments: mail.attachments } : {}) });
          status = mailLedgerStatus(out);
        }
      }
    }
  } catch (err) {
    status = 'FAILED'; logger.warn({ err: { name: err?.name } }, '[appointment-notices] citizen notice failed');
    if (attempted) await trail(noticeId, 'failed', 'exception', deps);
  }
  // R44-MAIL: the row takes the pre-chosen id whenever an e-mail was attempted (its status trail is keyed by it); only a PROVIDER_ACCEPTED row can
  // receive delivery events (api/_services/mail-events.js compare-and-set)
  await recordNotice(appointment.id, kind, 'citizen', 'email', status, db, attempted ? noticeId : undefined);
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
