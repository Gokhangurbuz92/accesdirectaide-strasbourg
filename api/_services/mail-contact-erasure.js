/**
 * Legal v5 (15/11/2026), v6 (17/11/2026) — the recipient's contact at the e-mail provider is deleted when the address stops being an account's address.
 *
 * Why: the Mailjet Send API saves every recipient address as a contact and keeps it for the lifetime of the Mailjet account
 * (https://dev.mailjet.com/email/guides/send-api-v31/ ; Help Center article 360042755094, read again 17/11/2026: « Your templates and contacts are kept for
 * the lifetime of your account »). Erasing the account in our database left that copy behind. Callers: the erasure of a citizen account
 * (api/_services/privacy.js executeApprovedDeletion — BEFORE the database erasure), the purge of never-confirmed accounts (gdpr-purge step 6c, before the
 * deletion transaction) and the confirmed change of address, for the OLD address (api/_services/email-change.js).
 *
 * How — Mailjet « GDPR Delete contacts », https://dev.mailjet.com/docs/email-api/contact-management/gdpr-delete-contacts (read 15/11 and 17/11/2026):
 *   1. GET    https://api.mailjet.com/v3/REST/contact/{email}        → Data[0].ID (the contact id)
 *   2. DELETE https://api.mailjet.com/v4/contacts/{contact_ID}       → « 200 OK »; « Any other response will indicate that the deletion was not
 *      successfully processed ». The contact is anonymised at once and its records are deleted after 30 days; this cannot be reversed.
 * Same credentials as the Send API (HTTP basic, MAILER_API_KEY = public:secret). Only the API key of this site is covered (the guide: a contact must be
 * removed from every account / sub-account that holds it — the site uses one).
 *
 * Owner decision C6 (17/11/2026, « HAYIR »): the address is never copied anywhere new — no retry list holding it (or a contact id derived from it) in the
 * KV store. A retry is possible only while the address is still in its existing place (the account row): the caller decides (privacy.js keeps an approved
 * erasure pending for a bounded window; 6c and the change of address cannot wait and record the failure). Outcomes (nothing here throws):
 *   skipped   the provider is not Mailjet (noop, test, resend, msgraph) or has no credentials: no contact exists there through this site → no call
 *   absent    Mailjet knows no such contact (404 on the lookup, or an empty answer)
 *   deleted   the DELETE answered 200 (or 404: the contact disappeared between the two calls)
 *   failed    anything else — `step` says where (lookup | delete | internal) and `status` the HTTP status (0 = unreachable). NEVER reported as deleted.
 * Logs carry the outcome, the step, the HTTP status and the reason — never the address, never the contact id.
 * The failure record itself (address-free, « intervention humaine requise ») is api/_services/mail-contact-failures.js.
 */
import { env } from '../_utils/env.js';
import { kv as defaultKv } from '../_utils/kv.js';
import defaultLogger from '../_utils/logger.js';

export const MAIL_CONTACT_PENDING_KEY = 'ada:mail-contact-erasure:pending:v1';
const KIND = 'ada-mail-contact-erasure';
const HTTP_TIMEOUT_MS = 5_000;
const API = 'https://api.mailjet.com';

/** @typedef {'skipped' | 'absent' | 'deleted' | 'failed'} MailContactOutcome */
/** @typedef {{ outcome: MailContactOutcome, status?: number, step?: 'lookup' | 'delete' | 'internal' }} MailContactResult */

/**
 * @param {{ fetchImpl?: typeof fetch, kv?: any, logger?: any, sleep?: (ms: number) => Promise<void>,
 *   config?: () => { provider?: string, apiKey?: string } }} [deps]
 */
export function createMailContactEraser(deps = {}) {
  const kv = deps.kv || defaultKv;
  const log = deps.logger || defaultLogger;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const config = deps.config || (() => ({ provider: env.mailer.provider, apiKey: env.mailer.apiKey }));

  /** @returns {string | null} the basic-auth header, or null when no Mailjet account is configured */
  const authorization = () => {
    const c = config();
    const key = String(c.apiKey || '').trim();
    if (String(c.provider || '').trim().toLowerCase() !== 'mailjet' || !key.includes(':')) return null;
    return `Basic ${Buffer.from(key).toString('base64')}`;
  };

  /**
   * One GET or DELETE, tried twice when the provider is unreachable, rate-limits or answers 5xx (both verbs are safe to repeat).
   * @param {'GET' | 'DELETE'} method @param {string} url @param {string} auth
   * @returns {Promise<{ status: number, body: any }>} status 0 = unreachable
   */
  const call = async (method, url, auth) => {
    const doFetch = deps.fetchImpl || fetch;
    for (let attempt = 0; ; attempt += 1) {
      let status = 0; let body = null;
      try {
        const res = await doFetch(url, { method, headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
        status = res.status;
        if (method === 'GET' && res.ok) body = await res.json().catch(() => null);
      } catch { status = 0; }
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= 1) return { status, body };
      await sleep(500);
    }
  };

  /** @param {number | string} contactId @param {string} auth @returns {Promise<{ done: boolean, status: number }>} 404 = no such contact any more: done */
  const deleteById = async (contactId, auth) => {
    const { status } = await call('DELETE', `${API}/v4/contacts/${encodeURIComponent(String(contactId))}`, auth);
    return { done: status === 200 || status === 404, status };
  };

  /** @param {unknown} v */
  const parse = (v) => {
    let x = v; if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }
    const e = /** @type {any} */ (x);
    return e && typeof e === 'object' && e.kind === KIND && /^\d{1,20}$/.test(String(e.contactId)) ? { contactId: String(e.contactId), queuedAt: String(e.queuedAt || ''), attempts: Number(e.attempts) || 0 } : null;
  };

  return {
    /** true when a Mailjet account is configured (contacts can exist there) */
    active: () => authorization() !== null,

    /**
     * Deletes the Mailjet contact of one address. Never throws.
     * @param {string | null | undefined} email @param {{ reason?: string }} [o] reason: a short label for the logs (« account_erasure », …)
     * @returns {Promise<MailContactResult>}
     */
    async erase(email, o = {}) {
      const reason = String(o.reason || 'erasure');
      /** @param {'lookup' | 'delete' | 'internal'} step @param {number} [status] @returns {MailContactResult} */
      const failed = (step, status) => {
        try { log.error({ msg: 'mail_contact.erasure_failed', reason, step, status: status ?? null }, '[mail-contact] provider contact NOT deleted'); } catch { /* the logger cannot break the caller */ }
        return { outcome: 'failed', step, ...(status === undefined ? {} : { status }) };
      };
      try {
        const auth = authorization();
        const address = String(email || '').trim();
        if (!auth || !address) return { outcome: 'skipped' };
        const found = await call('GET', `${API}/v3/REST/contact/${encodeURIComponent(address)}`, auth);
        if (found.status === 404) return { outcome: 'absent', status: 404 };
        const id = found.status === 200 ? found.body?.Data?.[0]?.ID : null;
        if (found.status === 200 && (id === null || id === undefined) && Number(found.body?.Count) === 0) return { outcome: 'absent', status: 200 };
        if (!/^\d{1,20}$/.test(String(id ?? ''))) return failed('lookup', found.status);
        const del = await deleteById(id, auth);
        if (!del.done) return failed('delete', del.status);
        try { log.info({ msg: 'mail_contact.erased', reason, status: del.status }, '[mail-contact] provider contact deleted'); } catch { /* deleted is deleted */ }
        return { outcome: 'deleted', status: del.status };
      } catch {
        return failed('internal');
      }
    },

    /**
     * Several addresses, a few at a time. Never throws.
     * @param {Array<string | null | undefined>} emails @param {{ reason?: string, concurrency?: number, onResult?: (r: MailContactResult) => void }} [o] onResult: per address, address-free
     * @returns {Promise<Record<MailContactOutcome, number>>}
     */
    async eraseMany(emails, o = {}) {
      /** @type {Record<MailContactOutcome, number>} */ const totals = { skipped: 0, absent: 0, deleted: 0, failed: 0 };
      const list = [...new Set((emails || []).map((e) => String(e || '').trim()).filter(Boolean))];
      const width = Math.max(1, Math.min(Number(o.concurrency) || 4, 8));
      let next = 0;
      const worker = async () => { while (next < list.length) { const e = list[next]; next += 1; const r = await this.erase(e, o); totals[r.outcome] += 1; try { o.onResult?.(r); } catch { /* ignore */ } } };
      await Promise.all(Array.from({ length: Math.min(width, list.length) }, worker));
      return totals;
    },

    /**
     * LEGACY ONLY (owner decision C6, 17/11/2026; Upstash Free may delete idle data, so nothing durable may live there): v5 put the numeric contact id
     * of a failed DELETE on a KV retry list. Nothing is ever written to that list again — not even back. One pass: each id left there is tried once
     * (oldest first), then the whole list is deleted; the ids Mailjet did not confirm are only COUNTED (`failed`) so the caller records them address-free
     * for a person (api/_services/mail-contact-failures.js). Without Mailjet credentials the list is left untouched (nothing can be tried). Never throws.
     * @returns {Promise<{ tried: number, deleted: number, failed: number, remaining: number }>}
     */
    async drainPending() {
      const out = { tried: 0, deleted: 0, failed: 0, remaining: 0 };
      try {
        const auth = authorization();
        const rows = await kv.lrange(MAIL_CONTACT_PENDING_KEY, 0, -1);
        const list = Array.isArray(rows) ? rows : [];
        const entries = list.map(parse).filter((e) => e !== null);
        out.remaining = list.length;
        if (!auth || list.length === 0) return out;
        for (const e of [...entries].reverse()) {
          out.tried += 1;
          const del = await deleteById(e.contactId, auth);
          if (del.done) out.deleted += 1; else out.failed += 1;
        }
        await kv.del(MAIL_CONTACT_PENDING_KEY);
        out.remaining = 0;
        log[out.failed ? 'warn' : 'info']({ msg: 'mail_contact.legacy_list_drained', ...out }, '[mail-contact] legacy v5 retry list drained and deleted');
      } catch (err) {
        log.error({ msg: 'mail_contact.pending_drain_failed', err: { name: /** @type {any} */ (err)?.name } }, '[mail-contact] legacy retry list could not be drained');
      }
      return out;
    },
  };
}

/** the eraser of the running process (provider and key read from the environment at each call) */
export const mailContactEraser = createMailContactEraser();
