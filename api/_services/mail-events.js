/**
 * R43-MAIL — what a provider's delivery events change, with the schema of migration 0042 (no new table, no new column):
 *
 *   1. the AppointmentNotice ledger row of the message (CustomID « appointment-notice/<id> »): PROVIDER_ACCEPTED → DELIVERED on « sent »;
 *      PROVIDER_ACCEPTED / DELIVERED → NOT_DELIVERED on a bounce or a block. Conditional updates: a repeated or late event never moves a row backwards, and
 *      a row that was never accepted (TEST_RECORDED, NO_CONSENT…) is never touched. The CHECK has no BOUNCED value: a bounce is NOT_DELIVERED.
 *   2. the suppression of an address after a hard bounce, a block caused by the recipient, or a spam complaint: one AuditLog row
 *      (action « mail.suppressed », entity « MailSuppression », entity_id = HMAC-SHA256 of the lower-case address under a key derived from
 *      ADA_ENCRYPTION_KEY, details { reason, provider }) — never the address. sendMail() reads it before writing (api/_utils/mailer.js).
 *      Without ADA_ENCRYPTION_KEY there is no key: nothing is recorded and nothing is suppressed (fail-open on delivery, never a plain address).
 *
 * Other ledgers (RdvNotificationLog, ParcoursReminder, pro notices) keep PROVIDER_ACCEPTED: their e-mails carry no notice id yet (counted as « unmatched »).
 */
import crypto from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AppointmentNotice, AuditLog } from '../../src/db/schema.js';
import logger from '../_utils/logger.js';
import { eventRecipient, mailjetEventSummary } from '../lib/mailjet-events.js';

export const SUPPRESSION_ACTION = 'mail.suppressed';
export const SUPPRESSION_ENTITY = 'MailSuppression';
/** the strongest reason wins: a hard bounce or a recipient block stops every e-mail, a complaint only the ones the person did not ask for */
const STRENGTH = { hard_bounce: 3, blocked: 2, spam: 1 };

/** @param {Record<string, string | undefined>} [vars] @returns {Buffer | null} */
function suppressionKey(vars = process.env) {
  const base = String(vars.ADA_ENCRYPTION_KEY || '').trim();
  if (base.length < 32) return null;
  return crypto.createHmac('sha256', base).update('ada-mail-suppression-v1', 'utf8').digest();
}

/** the pseudonymous key of an address, or null (no server key / not an address) @param {unknown} email @param {Record<string, string | undefined>} [vars] */
export function suppressionHash(email, vars = process.env) {
  const key = suppressionKey(vars);
  const v = String(email ?? '').trim().toLowerCase();
  if (!key || !v || !v.includes('@')) return null;
  return crypto.createHmac('sha256', key).update(v, 'utf8').digest('hex');
}

/**
 * The suppression reason recorded for an address, or null.
 * @param {string} email @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined> }} [deps]
 * @returns {Promise<'hard_bounce' | 'blocked' | 'spam' | null>}
 */
export async function suppressionReason(email, deps = {}) {
  const db = deps.db || defaultDb;
  const hash = suppressionHash(email, deps.vars);
  if (!hash) return null;
  /** @type {Array<{ details: unknown }>} */
  const rows = await db.select({ details: AuditLog.details }).from(AuditLog)
    .where(and(eq(AuditLog.action, SUPPRESSION_ACTION), eq(AuditLog.entity_id, hash))).orderBy(desc(AuditLog.timestamp)).limit(10);
  /** @type {'hard_bounce' | 'blocked' | 'spam' | null} */
  let best = null;
  for (const r of rows) {
    const reason = r?.details && typeof r.details === 'object' && 'reason' in r.details ? String(/** @type {{ reason: unknown }} */ (r.details).reason) : '';
    if ((reason === 'hard_bounce' || reason === 'blocked' || reason === 'spam') && (!best || STRENGTH[reason] > STRENGTH[best])) best = reason;
  }
  return best;
}

/**
 * Record one suppression (idempotent: the same address and reason is written once).
 * @param {string} email @param {'hard_bounce' | 'blocked' | 'spam'} reason @param {string} provider
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

/** @param {'DELIVERED' | 'NOT_DELIVERED'} status */
const fromStatuses = (status) => (status === 'DELIVERED' ? ['PROVIDER_ACCEPTED'] : ['PROVIDER_ACCEPTED', 'DELIVERED']);

/**
 * Apply one call's Mailjet events. Never throws for one bad event: each failure is counted and the rest is applied (Mailjet would otherwise retry the whole
 * batch for 24 h). Logs counts only.
 * @param {Array<Record<string, unknown>>} events @param {{ db?: typeof defaultDb, vars?: Record<string, string | undefined> }} [deps]
 */
export async function applyMailjetEvents(events, deps = {}) {
  const db = deps.db || defaultDb;
  const out = { received: events.length, delivered: 0, notDelivered: 0, suppressed: 0, unmatched: 0, ignored: 0, errors: 0 };
  for (const ev of events) {
    const s = mailjetEventSummary(ev);
    try {
      if (s.noticeStatus && s.noticeId) {
        /** @type {unknown[]} */
        const updated = await db.update(AppointmentNotice).set({ status: s.noticeStatus })
          .where(and(eq(AppointmentNotice.id, s.noticeId), eq(AppointmentNotice.channel, 'email'), inArray(AppointmentNotice.status, fromStatuses(s.noticeStatus))))
          .returning({ id: AppointmentNotice.id });
        if (Array.isArray(updated) && updated.length) out[s.noticeStatus === 'DELIVERED' ? 'delivered' : 'notDelivered'] += 1;
        else out.ignored += 1;
      } else if (s.noticeStatus) out.unmatched += 1;
      else if (!s.suppress) out.ignored += 1;
      if (s.suppress) {
        const to = eventRecipient(ev);
        if (to && await recordSuppression(to, s.suppress, 'mailjet', { db, vars: deps.vars })) out.suppressed += 1;
      }
    } catch (err) {
      out.errors += 1;
      logger.warn({ msg: 'mail_events.apply_failed', kind: s.kind, err: { name: err instanceof Error ? err.name : 'Error' } }, '[mail-events] event not applied');
    }
  }
  logger.info({ msg: 'mail_events.applied', provider: 'mailjet', ...out }, '[mail-events] Mailjet events applied');
  return out;
}
