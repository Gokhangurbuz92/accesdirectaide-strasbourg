/**
 * Legal v5 (15/11/2026) — the recipient's contact at the e-mail provider is deleted when the address stops being an account's address.
 *
 * Why: the Mailjet Send API saves every recipient address as a contact and keeps it for the lifetime of the Mailjet account
 * (https://dev.mailjet.com/email/guides/send-api-v31/ ; Help Center article 360042755094, read 15/11/2026). Erasing the account in our database left
 * that copy behind. Callers: the erasure of a citizen account (api/_services/privacy.js), the purge of never-confirmed accounts (gdpr-purge step 6c) and
 * the confirmed change of address, for the OLD address (api/_services/email-change.js).
 *
 * How — Mailjet « GDPR Delete contacts », https://dev.mailjet.com/docs/email-api/contact-management/gdpr-delete-contacts (read 15/11/2026):
 *   1. GET    https://api.mailjet.com/v3/REST/contact/{email}        → Data[0].ID (the contact id)
 *   2. DELETE https://api.mailjet.com/v4/contacts/{contact_ID}       → « 200 OK »; « Any other response will indicate that the deletion was not
 *      successfully processed ». The contact is anonymised at once and its records are deleted after 30 days; this cannot be reversed.
 * Same credentials as the Send API (HTTP basic, MAILER_API_KEY = public:secret). Only the API key of this site is covered (the guide: a contact must be
 * removed from every account / sub-account that holds it — the site uses one).
 *
 * Fail-safe: nothing here throws and nothing here blocks an erasure — it runs AFTER the database commit. Outcomes:
 *   skipped     the provider is not Mailjet (noop, test, resend, msgraph) or has no credentials: no contact exists there through this site → no call
 *   absent      Mailjet knows no such contact (404 on the lookup)                         deleted   the DELETE answered 200
 *   queued      the contact id is known but the DELETE failed: the NUMERIC id (never the address) is put on a retry list in the KV store and tried again
 *               at every later erasure and every purge run (drainPending) until Mailjet answers 200 or 404
 *   unresolved  the lookup itself failed (two attempts): the id is unknown and the address is not kept anywhere for a retry (it has just been erased) —
 *               logged and reported to the caller, which flags it (summary / failed step). The contact then follows Mailjet's own rule.
 * Logs carry the outcome, the HTTP status and the reason — never the address, never the contact id.
 */
import { env } from '../_utils/env.js';
import { kv as defaultKv } from '../_utils/kv.js';
import defaultLogger from '../_utils/logger.js';

export const MAIL_CONTACT_PENDING_KEY = 'ada:mail-contact-erasure:pending:v1';
export const MAIL_CONTACT_PENDING_MAX = 5000;
const KIND = 'ada-mail-contact-erasure';
const HTTP_TIMEOUT_MS = 5_000;
const API = 'https://api.mailjet.com';

/** @typedef {'skipped' | 'absent' | 'deleted' | 'queued' | 'unresolved'} MailContactOutcome */

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

  /** @param {{ contactId: string, queuedAt?: string, attempts?: number }} e @returns {Promise<boolean>} false = the retry list could not be written */
  const enqueue = async (e) => {
    try {
      await kv.lpush(MAIL_CONTACT_PENDING_KEY, JSON.stringify({ kind: KIND, contactId: String(e.contactId), queuedAt: e.queuedAt || new Date().toISOString(), attempts: e.attempts || 0 }));
      await kv.ltrim(MAIL_CONTACT_PENDING_KEY, 0, MAIL_CONTACT_PENDING_MAX - 1);
      return true;
    } catch { return false; }
  };

  return {
    /** true when a Mailjet account is configured (contacts can exist there) */
    active: () => authorization() !== null,

    /**
     * Deletes the Mailjet contact of one address. Never throws.
     * @param {string | null | undefined} email @param {{ reason?: string }} [o] reason: a short label for the logs (« account_erasure », …)
     * @returns {Promise<{ outcome: MailContactOutcome, status?: number }>}
     */
    async erase(email, o = {}) {
      const reason = String(o.reason || 'erasure');
      try {
        const auth = authorization();
        const address = String(email || '').trim();
        if (!auth || !address) return { outcome: 'skipped' };
        const found = await call('GET', `${API}/v3/REST/contact/${encodeURIComponent(address)}`, auth);
        if (found.status === 404) return { outcome: 'absent', status: 404 };
        const id = found.status === 200 ? found.body?.Data?.[0]?.ID : null;
        if (found.status === 200 && (id === null || id === undefined) && Number(found.body?.Count) === 0) return { outcome: 'absent', status: 200 };
        if (!/^\d{1,20}$/.test(String(id ?? ''))) {
          log.error({ msg: 'mail_contact.erasure_unresolved', reason, step: 'lookup', status: found.status }, '[mail-contact] contact lookup failed: provider contact not deleted');
          return { outcome: 'unresolved', status: found.status };
        }
        const del = await deleteById(id, auth);
        if (del.done) { log.info({ msg: 'mail_contact.erased', reason, status: del.status }, '[mail-contact] provider contact deleted'); return { outcome: 'deleted', status: del.status }; }
        const kept = await enqueue({ contactId: String(id) });
        log.error({ msg: kept ? 'mail_contact.erasure_queued' : 'mail_contact.erasure_unresolved', reason, step: 'delete', status: del.status },
          kept ? '[mail-contact] contact deletion failed: queued for retry' : '[mail-contact] contact deletion failed and the retry list is unavailable');
        return { outcome: kept ? 'queued' : 'unresolved', status: del.status };
      } catch (err) {
        log.error({ msg: 'mail_contact.erasure_unresolved', reason, step: 'internal', err: { name: /** @type {any} */ (err)?.name } }, '[mail-contact] contact deletion failed');
        return { outcome: 'unresolved' };
      }
    },

    /**
     * Several addresses, a few at a time. Never throws.
     * @param {Array<string | null | undefined>} emails @param {{ reason?: string, concurrency?: number }} [o]
     * @returns {Promise<Record<MailContactOutcome, number>>}
     */
    async eraseMany(emails, o = {}) {
      /** @type {Record<MailContactOutcome, number>} */ const totals = { skipped: 0, absent: 0, deleted: 0, queued: 0, unresolved: 0 };
      const list = [...new Set((emails || []).map((e) => String(e || '').trim()).filter(Boolean))];
      const width = Math.max(1, Math.min(Number(o.concurrency) || 4, 8));
      let next = 0;
      const worker = async () => { while (next < list.length) { const e = list[next]; next += 1; totals[(await this.erase(e, o)).outcome] += 1; } };
      await Promise.all(Array.from({ length: Math.min(width, list.length) }, worker));
      return totals;
    },

    /**
     * Tries the queued deletions again. Never throws.
     * @param {{ limit?: number }} [o] @returns {Promise<{ tried: number, deleted: number, remaining: number }>}
     */
    async drainPending(o = {}) {
      const out = { tried: 0, deleted: 0, remaining: 0 };
      try {
        const auth = authorization();
        const rows = await kv.lrange(MAIL_CONTACT_PENDING_KEY, 0, -1);
        const entries = (Array.isArray(rows) ? rows : []).map(parse).filter((e) => e !== null);
        out.remaining = entries.length;
        if (!auth || entries.length === 0) return out;
        const limit = Math.max(1, Number(o.limit) || 50);
        // oldest first (the list is newest first); an entry leaves the list only once Mailjet answered 200 or 404
        const ordered = [...entries].reverse();
        /** @type {typeof ordered} */ const keep = [];
        for (const [i, e] of ordered.entries()) {
          if (i >= limit) { keep.push(e); continue; }
          out.tried += 1;
          const del = await deleteById(e.contactId, auth);
          if (del.done) out.deleted += 1; else keep.push({ ...e, attempts: e.attempts + 1 });
        }
        if (out.deleted > 0 || out.tried > 0) {
          await kv.del(MAIL_CONTACT_PENDING_KEY);
          for (const e of keep) await enqueue(e);
        }
        out.remaining = keep.length;
        if (out.tried) log[out.remaining ? 'warn' : 'info']({ msg: 'mail_contact.pending_drained', ...out }, '[mail-contact] queued contact deletions retried');
      } catch (err) {
        log.error({ msg: 'mail_contact.pending_drain_failed', err: { name: /** @type {any} */ (err)?.name } }, '[mail-contact] retry of queued contact deletions failed');
      }
      return out;
    },
  };
}

/** the eraser of the running process (provider and key read from the environment at each call) */
export const mailContactEraser = createMailContactEraser();
