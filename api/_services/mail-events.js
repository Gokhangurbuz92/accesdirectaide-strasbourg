/**
 * R43-MAIL / R44-MAIL — what a provider's delivery events change, with the schema of migration 0042 (no new table, no new column, no migration):
 *
 *   1. the AppointmentNotice ledger row of the message (CustomID « appointment-notice/<id> »): PROVIDER_ACCEPTED → DELIVERED on « sent »;
 *      PROVIDER_ACCEPTED / DELIVERED → NOT_DELIVERED on a bounce or a block. Conditional (compare-and-set) updates: a repeated or late event never moves a
 *      row backwards, and a row that was never accepted (TEST_RECORDED, NO_CONSENT…) is never touched. The CHECK has no BOUNCED value: a bounce is
 *      NOT_DELIVERED in the ledger, and « bounced » in the status trail (api/lib/mail-status.js) — one AuditLog row per real transition.
 *   2. the suppression of an address after a hard bounce, a block caused by the recipient, or a spam complaint: one AuditLog row
 *      (action « mail.suppressed », entity « MailSuppression », entity_id = HMAC-SHA256 of the normalised address under a key derived from
 *      ADA_ENCRYPTION_KEY, details { reason, provider }) — never the address. sendMail() reads it before writing (api/_utils/mailer.js). Without
 *      ADA_ENCRYPTION_KEY there is no key: nothing is recorded and nothing is suppressed (fail-open on delivery, never a plain address).
 *      An administrator can lift it (liftSuppression: reason required, audited « mail.suppression_lifted »); an event older than the lift never re-applies it.
 *
 * R44-MAIL — what an event must prove before it changes anything (R43 security review, low finding 1: Mailjet signs nothing, so anyone holding the
 * basic-auth pair could replay or forge events):
 *   - a time inside the window (api/lib/mailjet-events.js eventTimeVerdict), otherwise ignored and counted (« outOfWindow »);
 *   - PROVENANCE: it names a message WE sent — the citizen e-mail notice of its CustomID (created before the event, at most 30 days earlier), or the
 *     Mailjet message id recorded when Mailjet accepted it (« mail.provider_accepted », written by sendMail() only while the events are on). Otherwise
 *     ignored and counted (« unknownOrigin »): a forged « hard_bounce » for an arbitrary address suppresses nothing;
 *   - a status change or a suppression also needs the event's address to be the one that message was sent to (its HMAC equals the recorded one, or the HMAC of the notice's
 *     verified account / sealed booking address), otherwise counted (« recipientMismatch »). So one structure's appointment can never suppress an address
 *     that was not its recipient, and a lookup failure on one event never affects another;
 *   - repeats inside a call are dropped (« duplicates », by event identity); repeats across calls are no-ops (compare-and-set, idempotent suppression).
 * Each call leaves one address-free AuditLog row (« mail.events_batch », counts only) — the source of the bounce / suppression burst alarm
 * (api/_handlers/cron/health-alert.js).
 *
 * Other ledgers (RdvNotificationLog, ParcoursReminder, pro notices) keep PROVIDER_ACCEPTED: their e-mails carry no notice id (counted as « unmatched »).
 */
import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AppointmentNotice, AuditLog, CitizenUser } from '../../src/db/schema.js';
import logger from '../_utils/logger.js';
import { appointmentGuestSchema } from '../_utils/schema-features.js';
import { MAX_FUTURE_SKEW_SECONDS, eventIdentity, eventRecipient, eventTime, eventTimeVerdict, mailjetEventSummary, normalizeAddress } from '../lib/mailjet-events.js';
import { isMailStatus, mailStatusFromEvent } from '../lib/mail-status.js';

export const SUPPRESSION_ACTION = 'mail.suppressed';
export const SUPPRESSION_ENTITY = 'MailSuppression';
export const LIFT_ACTION = 'mail.suppression_lifted';
export const ACCEPTED_ACTION = 'mail.provider_accepted';
export const ACCEPTED_ENTITY = 'MailMessage';
export const STATUS_ACTION = 'mail.notice_status';
export const BATCH_ACTION = 'mail.events_batch';
/** a notice older than this when its event arrives is not trusted as the origin of that event */
export const MAX_PROVENANCE_AGE_SECONDS = 30 * 24 * 3600;
/** one call with at least this many bounces / suppressions is logged as a burst (the hourly alarm is in health-alert) */
export const BURST_PER_CALL = 20;
/** the strongest reason wins: a hard bounce or a recipient block stops every e-mail, a complaint only the ones the person did not ask for */
const STRENGTH = { hard_bounce: 3, blocked: 2, spam: 1 };
/** @typedef {'hard_bounce' | 'blocked' | 'spam'} SuppressionReason */
/** @param {unknown} v @returns {v is SuppressionReason} */
const isReason = (v) => v === 'hard_bounce' || v === 'blocked' || v === 'spam';

/** @param {Record<string, string | undefined>} [vars] @returns {Buffer | null} */
function suppressionKey(vars = process.env) {
  const base = String(vars.ADA_ENCRYPTION_KEY || '').trim();
  if (base.length < 32) return null;
  return crypto.createHmac('sha256', base).update('ada-mail-suppression-v1', 'utf8').digest();
}

/** the pseudonymous key of an address, or null (no server key / not an address) @param {unknown} email @param {Record<string, string | undefined>} [vars] */
export function suppressionHash(email, vars = process.env) {
  const key = suppressionKey(vars);
  const v = normalizeAddress(email);
  if (!key || !v) return null;
  return crypto.createHmac('sha256', key).update(v, 'utf8').digest('hex');
}

/** @param {unknown} details @param {string} field */
const detail = (details, field) => (details && typeof details === 'object' && field in details ? /** @type {Record<string, unknown>} */ (details)[field] : undefined);

/**
 * The suppression reason recorded for an address, or null. Only the rows AFTER the newest lift count.
 * @param {string} email @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined> }} [deps]
 * @returns {Promise<SuppressionReason | null>}
 */
export async function suppressionReason(email, deps = {}) {
  const db = deps.db || defaultDb;
  const hash = suppressionHash(email, deps.vars);
  if (!hash) return null;
  /** @type {Array<{ action?: unknown, details: unknown }>} */
  const rows = await db.select({ action: AuditLog.action, details: AuditLog.details }).from(AuditLog)
    .where(and(inArray(AuditLog.action, [SUPPRESSION_ACTION, LIFT_ACTION]), eq(AuditLog.entity_id, hash))).orderBy(desc(AuditLog.timestamp)).limit(20);
  /** @type {SuppressionReason | null} */
  let best = null;
  for (const r of rows) {
    if (r?.action === LIFT_ACTION) break;   // newest first: everything below the newest lift was lifted
    const reason = detail(r?.details, 'reason');
    if (isReason(reason) && (!best || STRENGTH[reason] > STRENGTH[best])) best = reason;
  }
  return best;
}

/**
 * Record one suppression (idempotent: the same address and reason is written once).
 * @param {string} email @param {SuppressionReason} reason @param {string} provider
 * @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined> }} [deps] @returns {Promise<boolean>} true when a row was written
 */
export async function recordSuppression(email, reason, provider, deps = {}) {
  const db = deps.db || defaultDb;
  const hash = suppressionHash(email, deps.vars);
  if (!hash) return false;
  const existing = await suppressionReason(email, deps);
  if (existing && STRENGTH[existing] >= STRENGTH[reason]) return false;
  await db.insert(AuditLog).values({ action: SUPPRESSION_ACTION, actor: `mail-events:${provider}`, entity: SUPPRESSION_ENTITY, entity_id: hash, details: { reason, provider } });
  return true;
}

/**
 * R44-MAIL — an administrator lifts the suppression of one address (the person asked, the mailbox works again). The address is only hashed, never stored
 * or logged; the reason (10–500 characters) and the administrator are in the audit row. Nothing to lift → { lifted: false }.
 * @param {string} email @param {{ reason: string, by: string }} input
 * @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined> }} [deps]
 * @returns {Promise<{ ok: true, lifted: boolean, previous: SuppressionReason | null } | { ok: false, code: 'invalid_address' | 'reason_required' | 'no_key' }>}
 */
export async function liftSuppression(email, input, deps = {}) {
  const db = deps.db || defaultDb;
  if (!normalizeAddress(email)) return { ok: false, code: 'invalid_address' };
  const reason = String(input?.reason || '').trim();
  if (reason.length < 10 || reason.length > 500) return { ok: false, code: 'reason_required' };
  const hash = suppressionHash(email, deps.vars);
  if (!hash) return { ok: false, code: 'no_key' };
  const previous = await suppressionReason(email, deps);
  if (!previous) return { ok: true, lifted: false, previous: null };
  await db.insert(AuditLog).values({ action: LIFT_ACTION, actor: String(input.by || 'admin'), actor_id: String(input.by || '') || null, entity: SUPPRESSION_ENTITY,
    entity_id: hash, details: { previous, reason }, ip_hash: 'ADMIN_MFA' });
  return { ok: true, lifted: true, previous };
}

/**
 * R44-MAIL — sendMail() keeps the provenance of a message Mailjet accepted (only while the delivery events are on): its Mailjet message id, our CustomID,
 * the category and the HMAC of the recipient — never the address. A delivery event is trusted only for a message recorded here or a notice row.
 * @param {{ messageId: string, customId: string | null, category: string, to: string }} m
 * @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined> }} [deps] @returns {Promise<boolean>}
 */
export async function recordAcceptedMessage(m, deps = {}) {
  const db = deps.db || defaultDb;
  const recipientHash = suppressionHash(m.to, deps.vars);
  if (!recipientHash || !/^\d{1,24}$/.test(String(m.messageId || '')) || m.messageId === '0') return false;
  await db.insert(AuditLog).values({ action: ACCEPTED_ACTION, actor: 'mailer:mailjet', entity: ACCEPTED_ENTITY, entity_id: `mailjet:${m.messageId}`,
    details: { customId: m.customId, category: String(m.category || '').slice(0, 64), recipientHash } });
  return true;
}

/**
 * R44-MAIL — one row of the status trail of a citizen e-mail notice (api/lib/mail-status.js). Address-free; never throws (a trail write never changes
 * what was sent).
 * @param {string} noticeId @param {string} status @param {{ cause?: string | null, source: string, eventKey?: string }} info
 * @param {{ db?: typeof defaultDb }} [deps] @returns {Promise<boolean>}
 */
export async function recordNoticeStatus(noticeId, status, info, deps = {}) {
  const db = deps.db || defaultDb;
  if (!isMailStatus(status) || !noticeId) return false;
  try {
    await db.insert(AuditLog).values({ action: STATUS_ACTION, actor: info.source, entity: 'AppointmentNotice', entity_id: noticeId,
      details: { status, cause: info.cause ?? null, source: info.source, ...(info.eventKey ? { eventKey: info.eventKey } : {}) } });
    return true;
  } catch (err) {
    logger.warn({ msg: 'mail_status.trail_write_failed', status, err: { name: err instanceof Error ? err.name : 'Error' } }, '[mail-events] status trail not written');
    return false;
  }
}

/** the status trail of one notice, oldest first @param {string} noticeId @param {{ db?: typeof defaultDb }} [deps] */
export async function noticeStatusTrail(noticeId, deps = {}) {
  const db = deps.db || defaultDb;
  const rows = await db.select({ details: AuditLog.details, at: AuditLog.timestamp }).from(AuditLog)
    .where(and(eq(AuditLog.action, STATUS_ACTION), eq(AuditLog.entity, 'AppointmentNotice'), eq(AuditLog.entity_id, noticeId))).orderBy(AuditLog.timestamp);
  return rows.map((r) => ({ status: detail(r.details, 'status'), cause: detail(r.details, 'cause') ?? null, source: detail(r.details, 'source') ?? null, at: r.at }));
}

/**
 * @typedef {{ id: string, appointmentId: string, recipient: string, channel: string, status: string, createdAt: Date }} NoticeRow
 * @typedef {{ customId: string | null, recipientHash: string | null, at: Date }} AcceptedMessage
 * @typedef {{
 *   findNotice: (id: string) => Promise<NoticeRow | null>,
 *   findAcceptedMessage: (messageId: string) => Promise<AcceptedMessage | null>,
 *   noticeRecipientHash: (notice: NoticeRow) => Promise<string | null>,
 *   transitionNotice: (id: string, from: string[], to: 'DELIVERED' | 'NOT_DELIVERED') => Promise<boolean>,
 *   latestLiftAt: (hash: string) => Promise<Date | null>,
 *   recordStatus: (noticeId: string, status: string, info: { cause?: string | null, source: string, eventKey?: string }) => Promise<boolean>,
 *   recordSuppression: (email: string, reason: SuppressionReason) => Promise<boolean>,
 *   recordBatch: (counts: Record<string, number>) => Promise<void>,
 * }} MailEventStore
 */

/**
 * The PostgreSQL side of the events (schema of migration 0042; the sealed booking address only where migration 0043 added it).
 * @param {typeof defaultDb} db @param {Record<string, string | undefined>} [vars] @returns {MailEventStore}
 */
export function mailEventStore(db, vars) {
  return {
    async findNotice(id) {
      const [r] = await db.select({ id: AppointmentNotice.id, appointmentId: AppointmentNotice.appointmentId, recipient: AppointmentNotice.recipient, channel: AppointmentNotice.channel,
        status: AppointmentNotice.status, createdAt: AppointmentNotice.createdAt }).from(AppointmentNotice).where(eq(AppointmentNotice.id, id)).limit(1);
      return r || null;
    },
    async findAcceptedMessage(messageId) {
      const [r] = await db.select({ details: AuditLog.details, at: AuditLog.timestamp }).from(AuditLog)
        .where(and(eq(AuditLog.action, ACCEPTED_ACTION), eq(AuditLog.entity, ACCEPTED_ENTITY), eq(AuditLog.entity_id, `mailjet:${messageId}`))).orderBy(desc(AuditLog.timestamp)).limit(1);
      if (!r) return null;
      const customId = detail(r.details, 'customId'); const recipientHash = detail(r.details, 'recipientHash');
      return { customId: typeof customId === 'string' ? customId : null, recipientHash: typeof recipientHash === 'string' ? recipientHash : null, at: r.at };
    },
    async noticeRecipientHash(notice) {
      if (notice.recipient !== 'citizen') return null;
      const guest = (await appointmentGuestSchema(db)).guestBooking;
      const res = await db.execute(guest
        ? sql`SELECT "citizenUserId" AS u, "guestEmail" AS g FROM "ProAppointment" WHERE id = ${notice.appointmentId} LIMIT 1`
        : sql`SELECT "citizenUserId" AS u, NULL::text AS g FROM "ProAppointment" WHERE id = ${notice.appointmentId} LIMIT 1`);
      const row = res.rows[0];
      if (!row) return null;
      if (typeof row.u === 'string' && row.u) {
        const [u] = await db.select({ email: CitizenUser.email }).from(CitizenUser).where(eq(CitizenUser.id, row.u)).limit(1);
        return u?.email ? suppressionHash(u.email, vars) : null;
      }
      if (typeof row.g === 'string' && row.g) {
        const { decrypt, isV1Text } = await import('../lib/crypto.js');
        return isV1Text(row.g) ? suppressionHash(decrypt(row.g), vars) : null;
      }
      return null;
    },
    async transitionNotice(id, from, to) {
      const updated = await db.update(AppointmentNotice).set({ status: to })
        .where(and(eq(AppointmentNotice.id, id), eq(AppointmentNotice.channel, 'email'), inArray(AppointmentNotice.status, from)))
        .returning({ id: AppointmentNotice.id });
      return updated.length > 0;
    },
    async latestLiftAt(hash) {
      const [r] = await db.select({ at: AuditLog.timestamp }).from(AuditLog).where(and(eq(AuditLog.action, LIFT_ACTION), eq(AuditLog.entity_id, hash))).orderBy(desc(AuditLog.timestamp)).limit(1);
      return r?.at || null;
    },
    recordStatus: (noticeId, status, info) => recordNoticeStatus(noticeId, status, info, { db }),
    recordSuppression: (email, reason) => recordSuppression(email, reason, 'mailjet', { db, vars }),
    async recordBatch(counts) {
      await db.insert(AuditLog).values({ action: BATCH_ACTION, actor: 'mail-events:mailjet', entity: 'MailEvents', entity_id: 'mailjet', details: counts });
    },
  };
}

/** @param {'DELIVERED' | 'NOT_DELIVERED'} status */
const fromStatuses = (status) => (status === 'DELIVERED' ? ['PROVIDER_ACCEPTED'] : ['PROVIDER_ACCEPTED', 'DELIVERED']);

/**
 * Apply one call's Mailjet events. Never throws for one bad event: each failure is counted and the rest is applied. Logs counts only.
 * @param {Array<Record<string, unknown>>} events
 * @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined>, store?: MailEventStore, now?: number }} [deps]
 */
export async function applyMailjetEvents(events, deps = {}) {
  const store = deps.store || mailEventStore(deps.db || defaultDb, deps.vars);
  const now = deps.now ?? Date.now();
  const out = { received: events.length, delivered: 0, notDelivered: 0, suppressed: 0, unmatched: 0, ignored: 0, duplicates: 0, outOfWindow: 0, unknownOrigin: 0,
    recipientMismatch: 0, liftedBefore: 0, errors: 0 };
  const seen = new Set();
  for (const ev of events) {
    const s = mailjetEventSummary(ev);
    try {
      const identity = eventIdentity(ev);
      if (seen.has(identity)) { out.duplicates += 1; continue; }
      seen.add(identity);
      if (!s.noticeStatus && !s.suppress) { out.ignored += 1; continue; }   // open / click / unsub / unknown: nothing to change
      const time = eventTime(ev);
      if (time === null || eventTimeVerdict(time, now) !== 'ok') { out.outOfWindow += 1; continue; }

      // provenance: a notice we wrote before the event, or a Mailjet message id recorded when Mailjet accepted our message
      let notice = s.noticeId ? await store.findNotice(s.noticeId) : null;
      if (notice) {
        const created = Math.floor(new Date(notice.createdAt).getTime() / 1000);
        if (notice.channel !== 'email' || notice.recipient !== 'citizen' || created > time + MAX_FUTURE_SKEW_SECONDS || time - created > MAX_PROVENANCE_AGE_SECONDS) notice = null;
      }
      let accepted = s.messageId ? await store.findAcceptedMessage(s.messageId) : null;
      if (accepted && ((accepted.customId && s.customId && accepted.customId !== s.customId) || Math.floor(new Date(accepted.at).getTime() / 1000) > time + MAX_FUTURE_SKEW_SECONDS)) accepted = null;
      if (!notice && !accepted) { out.unknownOrigin += 1; continue; }
      // the event's address must be the one that message went to — for a status change as for a suppression (a forged event naming a real message id
      // but another address changes nothing)
      const recipient = eventRecipient(ev);
      const got = recipient ? suppressionHash(recipient, deps.vars) : null;
      const expected = accepted?.recipientHash || (notice ? await store.noticeRecipientHash(notice) : null);
      if (!recipient || !got || !expected || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) { out.recipientMismatch += 1; continue; }

      if (s.noticeStatus && notice) {
        const to = s.noticeStatus;
        if (await store.transitionNotice(notice.id, fromStatuses(to), to)) {
          out[to === 'DELIVERED' ? 'delivered' : 'notDelivered'] += 1;
          const status = mailStatusFromEvent(to);
          if (status) await store.recordStatus(notice.id, status, { cause: s.kind, source: 'mailjet_event', eventKey: identity });
        } else out.ignored += 1;   // a repeat, a late event after a bounce, or a row that was never accepted
      } else if (s.noticeStatus) out.unmatched += 1;

      if (s.suppress) {
        const lift = await store.latestLiftAt(got);
        if (lift && time * 1000 <= new Date(lift).getTime()) out.liftedBefore += 1;   // an event older than an administrator's lift never re-applies it
        else if (await store.recordSuppression(recipient, s.suppress)) out.suppressed += 1;
      }
    } catch (err) {
      out.errors += 1;
      logger.warn({ msg: 'mail_events.apply_failed', kind: s.kind, err: { name: err instanceof Error ? err.name : 'Error' } }, '[mail-events] event not applied');
    }
  }
  if (out.received > 0) {
    try { await store.recordBatch({ ...out }); } catch (err) {
      logger.warn({ msg: 'mail_events.batch_audit_failed', err: { name: err instanceof Error ? err.name : 'Error' } }, '[mail-events] batch audit row not written');
    }
  }
  if (out.notDelivered + out.suppressed >= BURST_PER_CALL) logger.warn({ msg: 'mail_events.burst', provider: 'mailjet', notDelivered: out.notDelivered, suppressed: out.suppressed }, '[mail-events] bounce / suppression burst in one call');
  logger.info({ msg: 'mail_events.applied', provider: 'mailjet', ...out }, '[mail-events] Mailjet events applied');
  return out;
}

/**
 * R44-MAIL — the bounce / suppression counts of the last `hours` (from the « mail.events_batch » rows: counts only), for the burst alarm.
 * @param {{ db?: typeof defaultDb, hours?: number }} [deps] @returns {Promise<{ notDelivered: number, suppressed: number, unknownOrigin: number, recipientMismatch: number, calls: number }>}
 */
export async function recentMailEventCounts(deps = {}) {
  const db = deps.db || defaultDb;
  const hours = Math.max(1, Math.min(48, Math.floor(deps.hours ?? 1)));
  const res = await db.execute(sql`SELECT count(*)::int AS calls,
      COALESCE(sum((details->>'notDelivered')::int), 0)::int AS "notDelivered", COALESCE(sum((details->>'suppressed')::int), 0)::int AS suppressed,
      COALESCE(sum((details->>'unknownOrigin')::int), 0)::int AS "unknownOrigin", COALESCE(sum((details->>'recipientMismatch')::int), 0)::int AS "recipientMismatch"
    FROM "AuditLog" WHERE action = ${BATCH_ACTION} AND timestamp > NOW() - make_interval(hours => ${hours})`);
  const r = res.rows[0] || {};
  const n = (/** @type {unknown} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { notDelivered: n(r.notDelivered), suppressed: n(r.suppressed), unknownOrigin: n(r.unknownOrigin), recipientMismatch: n(r.recipientMismatch), calls: n(r.calls) };
}
