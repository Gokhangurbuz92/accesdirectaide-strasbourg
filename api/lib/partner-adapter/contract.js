// @ts-check
/**
 * FA-D7 — partner referral adapter: the VERSIONED CONTRACT `ada.partner-referral/1` (pure functions, no I/O).
 *
 * Purpose (references/07: « keep two ways: native ADA Pro or approved adapters to existing partner systems »): a receiving organization that already works
 * in its own tool can be told, in that tool, that a referral the PERSON authorized has reached it, and can answer from that tool — instead of being forced
 * to work in ADA Pro. The adapter is closed by default (capability `partner.referral_adapter`, outside the AIPD, HDS-bound) and no real partner exists.
 *
 * Data minimisation (the whole contract): an event carries the referral identifier, its state, the controlled reason code, the due date and a link to ADA
 * Pro — NEVER a name, an address, a dossier content, a message, a note or a citizen identifier. The partner's staff open the dossier through ADA Pro with
 * their own account and the person's grant, exactly as on the native path. Nothing is sent before the person authorized the referral (state SENT).
 *
 * Outbound (ADA → partner), POST <partner endpoint>, JSON:
 *   { contract: 'ada.partner-referral/1', eventId, type, occurredAt, referral: { id, status, reasonCode, dueAt, proUrl } }
 *   headers: Content-Type: application/json; Idempotency-Key: <eventId> (the same for every retry of one event); ADA-Contract: ada.partner-referral/1;
 *            ADA-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${canonical JSON body}`)>
 *   the partner answers 2xx once stored (a 2xx for an already-seen eventId is expected: the partner deduplicates on Idempotency-Key).
 *
 * Inbound (partner → ADA), POST /api/monitor/partner/referral-events?partner=<partnerId>, JSON:
 *   { contract: 'ada.partner-referral/1', idempotencyKey, referralId, action, responseCode?, outcome?, message?, citizenSummary?, occurredAt }
 *   same ADA-Signature header, computed by the partner with ITS shared secret; a timestamp more than SIGNATURE_TOLERANCE_S away is refused (replay).
 *
 * Canonical JSON (signature input): the body re-serialised with object keys sorted at every level, no whitespace (JSON.stringify of a key-sorted copy).
 * The router parses the body before the handler runs, so the signature is defined over this canonical form, not over the raw bytes; both sides compute
 * it the same way (tests/unit/fa7-partner-adapter-contract.test.js holds a fixed vector).
 */
import crypto from 'node:crypto';

export const PARTNER_CONTRACT = 'ada.partner-referral/1';
export const SIGNATURE_HEADER = 'ada-signature';
export const SIGNATURE_TOLERANCE_S = 300;
export const MIN_SECRET_LENGTH = 32;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const UUIDISH = /^[A-Za-z0-9-]{8,80}$/;

/** outbound event types: a state the RECEIVER must know about (never one before the person's authorization) */
export const EVENT_TYPES = Object.freeze({
  SENT: 'referral.received',          // the person authorized the referral (or the sender answered a request for information)
  CANCELLED: 'referral.cancelled',    // the sender cancelled, or the person withdrew the access
  EXPIRED: 'referral.expired',        // no answer in time: the access is withdrawn
  CLOSED: 'referral.closed',          // the sender closed the referral
});
/** the ReferralEvent target states that produce an outbound event */
export const OUTBOUND_STATES = Object.freeze(Object.keys(EVENT_TYPES));

/** inbound actions (the receiver's own steps on the native path, api/_services/referrals.js act()) — v1 has no redirect suggestion (ADA identifiers) */
export const INBOUND_ACTIONS = Object.freeze(['acknowledge', 'accept', 'decline', 'needs_info', 'start', 'complete']);
export const INBOUND_DECLINE_CODES = Object.freeze(['OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'OTHER']);
export const INBOUND_OUTCOMES = Object.freeze(['SUPPORT_COMPLETED', 'APPLICATION_FILED', 'INFORMATION_PROVIDED', 'REFERRED_ELSEWHERE', 'CITIZEN_WITHDREW', 'NO_RESPONSE', 'OTHER']);
const INBOUND_FIELDS = new Set(['contract', 'idempotencyKey', 'referralId', 'action', 'responseCode', 'outcome', 'message', 'citizenSummary', 'occurredAt']);

/** @param {unknown} v @returns {unknown} */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(/** @type {object} */ (v)).sort().map((k) => [k, sortKeys(/** @type {any} */ (v)[k])]));
  return v;
}
/** @param {unknown} body */
export const canonicalJson = (body) => JSON.stringify(sortKeys(body));

/** @param {string} secret @param {number} t unix seconds @param {unknown} body */
export function signatureOf(secret, t, body) {
  return crypto.createHmac('sha256', String(secret)).update(`${t}.${canonicalJson(body)}`).digest('hex');
}
/** the header value @param {string} secret @param {unknown} body @param {number} [t] */
export function signHeader(secret, body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${signatureOf(secret, t, body)}`;
}

/**
 * @param {{ header: unknown, body: unknown, secret: string | null | undefined, nowSeconds?: number }} p
 * @returns {{ ok: true } | { ok: false, reason: 'NOT_CONFIGURED' | 'MISSING_SIGNATURE' | 'STALE' | 'BAD_SIGNATURE' }}
 */
export function verifySignature({ header, body, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!secret || String(secret).length < MIN_SECRET_LENGTH) return { ok: false, reason: 'NOT_CONFIGURED' };
  const raw = Array.isArray(header) ? String(header[0] ?? '') : typeof header === 'string' ? header : '';
  const parts = Object.fromEntries(raw.split(',').map((x) => x.trim().split('=')).filter((x) => x.length === 2));
  if (!/^\d{1,12}$/.test(parts.t || '') || !/^[0-9a-f]{64}$/.test(parts.v1 || '')) return { ok: false, reason: 'MISSING_SIGNATURE' };
  const t = Number(parts.t);
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_S) return { ok: false, reason: 'STALE' };
  const expected = Buffer.from(signatureOf(String(secret), t, body), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}

/**
 * The outbound event of one ReferralEvent row (or null when the state is not one the receiver is told about).
 * @param {{ id: string, toStatus: string, createdAt: Date | string }} ev @param {{ id: string, reasonCode?: string | null, dueAt?: Date | string | null }} referral
 * @param {string} proUrl link to the referral in ADA Pro (no identifier of the person)
 */
export function buildOutboundEvent(ev, referral, proUrl) {
  const type = /** @type {Record<string, string>} */ (EVENT_TYPES)[ev.toStatus];
  if (!type) return null;
  const iso = (/** @type {any} */ d) => (d ? new Date(d).toISOString() : null);
  return {
    contract: PARTNER_CONTRACT, eventId: ev.id, type, occurredAt: iso(ev.createdAt),
    referral: { id: referral.id, status: ev.toStatus, reasonCode: referral.reasonCode || null, dueAt: iso(referral.dueAt), proUrl },
  };
}

/** the exact keys an outbound event may hold (contract test: nothing personal can be added silently) */
export const OUTBOUND_KEYS = Object.freeze({ top: ['contract', 'eventId', 'type', 'occurredAt', 'referral'], referral: ['id', 'status', 'reasonCode', 'dueAt', 'proUrl'] });

/**
 * Validate an inbound body. Returns the normalized command or the list of problems (machine codes, no value echoed).
 * @param {unknown} body
 * @returns {{ ok: true, cmd: { idempotencyKey: string, referralId: string, action: string, input: Record<string, string> } } | { ok: false, problems: string[] }}
 */
export function validateInbound(body) {
  /** @type {string[]} */ const problems = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, problems: ['body'] };
  const b = /** @type {Record<string, unknown>} */ (body);
  if (Object.keys(b).some((k) => !INBOUND_FIELDS.has(k))) problems.push('extra-field');
  if (b.contract !== PARTNER_CONTRACT) problems.push('contract');
  if (typeof b.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(b.idempotencyKey)) problems.push('idempotencyKey');
  if (typeof b.referralId !== 'string' || !UUIDISH.test(b.referralId)) problems.push('referralId');
  if (typeof b.action !== 'string' || !INBOUND_ACTIONS.includes(b.action)) problems.push('action');
  if (typeof b.occurredAt !== 'string' || Number.isNaN(Date.parse(b.occurredAt))) problems.push('occurredAt');
  const str = (/** @type {unknown} */ v, /** @type {number} */ max) => v === undefined || (typeof v === 'string' && v.length <= max);
  if (!str(b.message, 1500)) problems.push('message');
  if (!str(b.citizenSummary, 1000)) problems.push('citizenSummary');
  if (b.action === 'decline' && !INBOUND_DECLINE_CODES.includes(String(b.responseCode))) problems.push('responseCode');
  if (b.action !== 'decline' && b.responseCode !== undefined) problems.push('responseCode');
  if (b.action === 'needs_info' && (typeof b.message !== 'string' || b.message.trim().length < 5)) problems.push('message');
  if (b.action === 'complete' && !INBOUND_OUTCOMES.includes(String(b.outcome))) problems.push('outcome');
  if (b.action !== 'complete' && (b.outcome !== undefined || b.citizenSummary !== undefined)) problems.push('outcome');
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  /** @type {Record<string, string>} */ const input = {};
  for (const k of ['responseCode', 'outcome', 'message', 'citizenSummary']) if (typeof b[k] === 'string') input[k] = /** @type {string} */ (b[k]);
  return { ok: true, cmd: { idempotencyKey: /** @type {string} */ (b.idempotencyKey), referralId: /** @type {string} */ (b.referralId), action: /** @type {string} */ (b.action), input } };
}
