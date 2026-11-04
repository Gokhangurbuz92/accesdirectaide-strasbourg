/**
 * R44-MAIL — the auditable status of ONE transactional e-mail notice, as pure functions (no I/O).
 *
 * The AppointmentNotice ledger keeps the coarse values its CHECK constraint allows on every database level (migrations 0025 → 0042 and 0045 only widen
 * the KIND check): DELIVERED, PROVIDER_ACCEPTED, TEST_RECORDED, NOT_DELIVERED, NO_CONSENT, NO_RECIPIENT, FAILED. No migration is added: the finer status
 * of an e-mail is an append-only trail in AuditLog (action « mail.notice_status », entity « AppointmentNotice », entity_id = the notice id, details
 * { status, cause, source }), written by api/_services/mail-events.js. Address-free.
 *
 *   queued             the notice id is chosen and the message is about to be handed to the mailer
 *   sandbox_simulated  nothing left the machine (test outbox) or Mailjet SandboxMode validated it and delivered NOTHING
 *   provider_accepted  a real provider accepted the request — not a delivery
 *   delivered          ONLY from an authenticated, provenance-checked provider event (Mailjet « sent »)
 *   bounced            a provider event said it could not be delivered (bounce, or blocked by Mailjet)
 *   suppressed         not sent: the address is suppressed (an earlier hard bounce / block / complaint)
 *   failed             not handed over (no provider, provider refusal, network error, exception)
 *
 * Monotonic: a status only moves to a higher rank (queued → accepted → delivered → bounced); sandbox_simulated, suppressed and failed are final.
 */

export const MAIL_STATUSES = Object.freeze(['queued', 'sandbox_simulated', 'provider_accepted', 'delivered', 'bounced', 'suppressed', 'failed']);
/** @typedef {'queued' | 'sandbox_simulated' | 'provider_accepted' | 'delivered' | 'bounced' | 'suppressed' | 'failed'} MailStatus */

/** @param {unknown} v @returns {v is MailStatus} */
export const isMailStatus = (v) => typeof v === 'string' && MAIL_STATUSES.includes(v);

/** @type {Readonly<Record<MailStatus, number>>} */
export const MAIL_STATUS_RANK = Object.freeze({ queued: 0, sandbox_simulated: 1, provider_accepted: 1, suppressed: 1, failed: 1, delivered: 2, bounced: 3 });
/** the statuses after which nothing else can happen */
const FINAL = new Set(['sandbox_simulated', 'suppressed', 'failed', 'bounced']);

/**
 * Whether `to` may follow `from` (null = no status yet). A repeat of the same status is NOT a transition (it is a duplicate).
 * @param {MailStatus | null} from @param {MailStatus} to
 */
export function canTransition(from, to) {
  if (!isMailStatus(to)) return false;
  if (from === null) return true;
  if (from === to || FINAL.has(from)) return false;
  return MAIL_STATUS_RANK[to] > MAIL_STATUS_RANK[from];
}

/**
 * The status of a sendMail() result (api/_utils/mailer.js outcomes), with an address-free cause.
 * @param {{ outcome?: string, errorCode?: string | null, failure?: string } | null | undefined} out
 * @returns {{ status: MailStatus, cause: string | null }}
 */
export function mailStatusFromSend(out) {
  const outcome = String(out?.outcome || '');
  if (outcome === 'PROVIDER_ACCEPTED') return { status: 'provider_accepted', cause: null };
  if (outcome === 'SANDBOX_VALIDATED') return { status: 'sandbox_simulated', cause: 'provider_sandbox' };
  if (outcome === 'TEST_RECORDED') return { status: 'sandbox_simulated', cause: 'test_outbox' };
  if (out?.errorCode === 'suppressed') return { status: 'suppressed', cause: 'suppressed' };
  if (outcome === 'NOT_SENT') return { status: 'failed', cause: 'not_configured' };
  return { status: 'failed', cause: typeof out?.failure === 'string' && /^[a-z_]{1,20}$/.test(out.failure) ? out.failure : 'unknown' };
}

/**
 * The status a provider event moves a notice to (null: no status change — e.g. a spam complaint on a delivered message, open / click / unsub).
 * @param {'DELIVERED' | 'NOT_DELIVERED' | null} noticeStatus the ledger value of mailjetEventSummary() @returns {MailStatus | null}
 */
export function mailStatusFromEvent(noticeStatus) {
  if (noticeStatus === 'DELIVERED') return 'delivered';
  if (noticeStatus === 'NOT_DELIVERED') return 'bounced';
  return null;
}

/**
 * The current status from a trail (any order), or null. Ignores unknown values and anything that would not be a valid transition, so a forged or
 * out-of-order row can never move it backwards.
 * @param {Array<{ status?: unknown, at?: Date | string | null }>} trail @returns {MailStatus | null}
 */
export function currentMailStatus(trail) {
  const rows = [...(Array.isArray(trail) ? trail : [])].sort((a, b) => new Date(a?.at ?? 0).getTime() - new Date(b?.at ?? 0).getTime());
  /** @type {MailStatus | null} */
  let cur = null;
  for (const r of rows) {
    const s = r?.status;
    if (isMailStatus(s) && canTransition(cur, s)) cur = s;
  }
  return cur;
}
