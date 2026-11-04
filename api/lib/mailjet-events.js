/**
 * R43-MAIL — Mailjet delivery events (Event API webhooks): authentication of the call and an address-free summary of each event, as pure functions.
 *
 * Sources (read 4 Nov 2026): dev.mailjet.com/email/guides/webhooks/ (event types sent / open / click / bounce / blocked / spam / unsub; the endpoint must
 * answer 200, otherwise Mailjet retries every 30 s for 24 h; the only documented protection is HTTPS with basic auth in the callback URL
 * « https://user:password@host/path » — there is NO signature), dev.mailjet.com/docs/email-api/webhooks/event-types (fields event, time, email, MessageID,
 * Message_GUID, CustomID, Payload; bounce: blocked, hard_bounce, error_related_to, error; blocked: error_related_to, error; spam: source),
 * dev.mailjet.com/docs/email-api/webhooks/values-for-errors (error_related_to « recipient » with « user unknown », « preblocked », « spam reporter »,
 * « blacklisted »…). With « Group events » (version 2) the body is an array of the same objects.
 *
 * What may be logged or stored: the event type, the meaning, Mailjet's numeric message id, our CustomID — never `email`, `smtp_reply`, `comment`, `ip`, `geo`.
 */
import crypto from 'node:crypto';

/** at most this many events per call are read (Mailjet groups events; it documents no maximum group size) — R44: a call with more is refused (413) */
export const MAX_EVENTS_PER_CALL = 500;
/** R44-MAIL: the largest body accepted (about 2 KB per event at 500 events); a larger one is refused with 413 before anything is applied */
export const MAX_BODY_BYTES = 1024 * 1024;
/**
 * R44-MAIL — the time window of an event (its `time`, Unix seconds): Mailjet retries a refused call every 30 s for 24 h (dev.mailjet.com/docs/email-api/
 * webhooks/webhooks-overview, read 4 Nov 2026), so a genuine event is never much older than a day after it happened; 96 h leaves room for a delayed
 * bounce. Older, or more than 10 minutes in the future (clock skew), it is ignored and counted — a replay of an old captured call changes nothing.
 */
export const MAX_EVENT_AGE_SECONDS = 96 * 3600;
export const MAX_FUTURE_SKEW_SECONDS = 600;

const digest = (/** @type {string} */ s) => crypto.createHash('sha256').update(s, 'utf8').digest();

/**
 * Basic-auth check of a webhook call, in constant time (both parts compared as SHA-256 digests, so the lengths leak nothing). Fail-closed: without the
 * configured pair nothing is ever accepted; a password shorter than 24 characters is refused as a configuration error.
 * @param {unknown} authorization the Authorization header
 * @param {{ user?: string | null, password?: string | null }} expected
 * @returns {'OK' | 'NOT_CONFIGURED' | 'MISSING' | 'BAD'}
 */
export function verifyMailjetBasicAuth(authorization, expected) {
  const user = String(expected?.user ?? '').trim(); const password = String(expected?.password ?? '');
  if (!user || password.length < 24) return 'NOT_CONFIGURED';
  const h = typeof authorization === 'string' ? authorization.trim() : Array.isArray(authorization) ? String(authorization[0] ?? '').trim() : '';
  const m = /^Basic\s+([A-Za-z0-9+/=]{4,1024})$/i.exec(h);
  if (!m) return 'MISSING';
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 1) return 'BAD';
  const okUser = crypto.timingSafeEqual(digest(decoded.slice(0, i)), digest(user));
  const okPassword = crypto.timingSafeEqual(digest(decoded.slice(i + 1)), digest(password));
  return okUser && okPassword ? 'OK' : 'BAD';
}

/**
 * The events of one call: one object (Group events off) or an array (on); a string or Buffer body is parsed. Anything else → []. (The handler checks the
 * body with inspectMailjetBody() first: an over-long array is refused there, never cut silently.)
 * @param {unknown} body @returns {Array<Record<string, unknown>>}
 */
export function parseMailjetEvents(body) {
  let data = body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) data = data.toString('utf8');
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return []; }
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  return list.slice(0, MAX_EVENTS_PER_CALL).filter((e) => e && typeof e === 'object' && !Array.isArray(e));
}

/** the AppointmentNotice row named by a CustomID « appointment-notice/<uuid> » (set by api/_services/appointment-notices.js), or null @param {unknown} customId */
export function noticeIdFromCustomId(customId) {
  const m = /^appointment-notice\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(customId ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * @typedef {{
 *   event: string,
 *   kind: 'delivered' | 'bounce_hard' | 'bounce_soft' | 'blocked' | 'spam' | 'unsub' | 'engagement' | 'other',
 *   messageId: string | null,
 *   customId: string | null,
 *   noticeId: string | null,
 *   noticeStatus: 'DELIVERED' | 'NOT_DELIVERED' | null,
 *   suppress: 'hard_bounce' | 'blocked' | 'spam' | null,
 *   errorRelatedTo: string | null,
 *   error: string | null,
 * }} MailjetEventSummary
 */

/**
 * The address-free meaning of one event, mapped onto the existing ledger values (AppointmentNotice CHECK: DELIVERED, PROVIDER_ACCEPTED, TEST_RECORDED,
 * NOT_DELIVERED, NO_CONSENT, NO_RECIPIENT, FAILED — no BOUNCED value, so a bounce is NOT_DELIVERED):
 *   sent     the receiving server accepted the message                       → DELIVERED
 *   bounce   the receiving server refused it (hard = permanent)              → NOT_DELIVERED; hard bounce → suppression
 *   blocked  Mailjet did not send it (preblocked, spam reporter, content…)   → NOT_DELIVERED; suppression only when the cause is the recipient
 *   spam     the person marked it as spam (it was delivered)                 → no status change; suppression
 *   unsub / open / click → no change (no list, tracking is off in every message)
 * @param {Record<string, unknown>} ev @returns {MailjetEventSummary}
 */
export function mailjetEventSummary(ev) {
  const event = typeof ev?.event === 'string' && /^[a-z_]{1,20}$/.test(ev.event) ? ev.event : 'unknown';
  const rawId = ev?.MessageID ?? ev?.mj_message_id;
  const messageId = (typeof rawId === 'number' || typeof rawId === 'string') && /^\d{1,24}$/.test(String(rawId)) ? String(rawId) : null;
  const customId = typeof ev?.CustomID === 'string' && /^[A-Za-z0-9/_:.-]{1,256}$/.test(ev.CustomID) ? ev.CustomID : null;
  const errorRelatedTo = typeof ev?.error_related_to === 'string' && /^[a-z ]{1,20}$/.test(ev.error_related_to) ? ev.error_related_to : null;
  const error = typeof ev?.error === 'string' && /^[a-z0-9 _-]{1,40}$/i.test(ev.error) ? ev.error.toLowerCase() : null;
  const hard = ev?.hard_bounce === true || ev?.hard_bounce === 'true';
  /** @type {MailjetEventSummary['kind']} */
  let kind = 'other';
  /** @type {MailjetEventSummary['noticeStatus']} */
  let noticeStatus = null;
  /** @type {MailjetEventSummary['suppress']} */
  let suppress = null;
  if (event === 'sent') { kind = 'delivered'; noticeStatus = 'DELIVERED'; }
  else if (event === 'bounce') { kind = hard ? 'bounce_hard' : 'bounce_soft'; noticeStatus = 'NOT_DELIVERED'; if (hard) suppress = 'hard_bounce'; }
  else if (event === 'blocked') { kind = 'blocked'; noticeStatus = 'NOT_DELIVERED'; if (errorRelatedTo === 'recipient') suppress = 'blocked'; }
  else if (event === 'spam') { kind = 'spam'; suppress = 'spam'; }
  else if (event === 'unsub') kind = 'unsub';
  else if (event === 'open' || event === 'click') kind = 'engagement';
  return { event, kind, messageId, customId, noticeId: noticeIdFromCustomId(customId), noticeStatus, suppress, errorRelatedTo, error };
}

/**
 * R44-MAIL — the one normalisation of an address for a suppression key: Unicode NFC, trimmed, lower-cased (as R43, so existing keys stay valid). One
 * « @ », no space or control character, a dotted domain, at most 254 characters. Plus-tags and dots are KEPT (they can be different mailboxes): two
 * addresses are never merged by guesswork. Returns null for anything else.
 * @param {unknown} value @returns {string | null}
 */
export function normalizeAddress(value) {
  if (typeof value !== 'string') return null;
  const v = value.normalize('NFC').trim().toLowerCase();
  if (!v || v.length > 254 || /[\s<>()",;]/.test(v) || [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  const at = v.indexOf('@');
  if (at < 1 || at !== v.lastIndexOf('@')) return null;
  const domain = v.slice(at + 1);
  return /^[^.@]+(\.[^.@]+)+$/.test(domain) && /\.[\p{L}a-z]{2,}$/u.test(domain) ? v : null;
}

/** the recipient of an event, only for the suppression key (never logged, never stored as such) @param {Record<string, unknown>} ev @returns {string | null} */
export function eventRecipient(ev) {
  return normalizeAddress(ev?.email);
}

/**
 * R44-MAIL — the first check of a call's body, before anything is applied: size (413 BODY_TOO_LARGE), JSON (400 INVALID_JSON), shape (400 INVALID_BODY:
 * one event object or an array of them), count (413 TOO_MANY_EVENTS). Mailjet would retry a refused call, but none of these can come from a genuine
 * Mailjet call (it sends one JSON object, or an array with « Group events »), so the refusal is the clear answer. `contentLength` is the header value.
 * @param {unknown} body @param {unknown} contentLength
 * @returns {{ ok: true, events: Array<Record<string, unknown>> } | { ok: false, status: 400 | 413, code: string }}
 */
export function inspectMailjetBody(body, contentLength) {
  const declared = Number(Array.isArray(contentLength) ? contentLength[0] : contentLength);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413, code: 'BODY_TOO_LARGE' };
  /** @type {unknown} */
  let data = body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    if (data.length > MAX_BODY_BYTES) return { ok: false, status: 413, code: 'BODY_TOO_LARGE' };
    data = data.toString('utf8');
  }
  if (typeof data === 'string') {
    if (Buffer.byteLength(data, 'utf8') > MAX_BODY_BYTES) return { ok: false, status: 413, code: 'BODY_TOO_LARGE' };
    if (!data.trim()) return { ok: true, events: [] };
    try { data = JSON.parse(data); } catch { return { ok: false, status: 400, code: 'INVALID_JSON' }; }
  }
  if (data === undefined || data === null) return { ok: true, events: [] };
  const list = Array.isArray(data) ? data : typeof data === 'object' ? [data] : null;
  if (!list) return { ok: false, status: 400, code: 'INVALID_BODY' };
  if (list.length > MAX_EVENTS_PER_CALL) return { ok: false, status: 413, code: 'TOO_MANY_EVENTS' };
  /** @type {Array<Record<string, unknown>>} */
  const events = [];
  for (const e of list) if (e && typeof e === 'object' && !Array.isArray(e)) events.push(e);
  return { ok: true, events };
}

/** the event's `time` (Unix seconds), or null @param {Record<string, unknown>} ev */
export function eventTime(ev) {
  const t = typeof ev?.time === 'number' ? ev.time : typeof ev?.time === 'string' && /^\d{9,11}$/.test(ev.time) ? Number(ev.time) : NaN;
  return Number.isFinite(t) && t > 0 ? Math.floor(t) : null;
}

/**
 * Whether an event's time is inside the accepted window (MAX_EVENT_AGE_SECONDS back, MAX_FUTURE_SKEW_SECONDS ahead).
 * @param {number | null} time @param {number} [nowMs] @returns {'ok' | 'missing' | 'too_old' | 'future'}
 */
export function eventTimeVerdict(time, nowMs = Date.now()) {
  if (time === null) return 'missing';
  const now = Math.floor(nowMs / 1000);
  if (time < now - MAX_EVENT_AGE_SECONDS) return 'too_old';
  if (time > now + MAX_FUTURE_SKEW_SECONDS) return 'future';
  return 'ok';
}

/**
 * R44-MAIL — the identity of one event (to drop a repeat inside a call and to audit transitions without any address): SHA-256 of the event type, the
 * message ids, our CustomID and the time. Mailjet retries a whole call: the same event comes back with the same identity.
 * @param {Record<string, unknown>} ev @returns {string}
 */
export function eventIdentity(ev) {
  const s = mailjetEventSummary(ev);
  const guid = typeof ev?.Message_GUID === 'string' && /^[0-9a-f-]{8,64}$/i.test(ev.Message_GUID) ? ev.Message_GUID.toLowerCase() : '';
  const parts = ['mailjet', s.event, s.messageId || '', guid, s.customId || '', String(eventTime(ev) ?? ''), s.kind];
  return crypto.createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
}
