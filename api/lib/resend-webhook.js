/**
 * R41-E — Resend delivery events (bounce / complaint / delivered…): the signature check and an address-free summary, as pure functions.
 * NOT ROUTED: no endpoint exists yet (see STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r41/R41_PROVIDER_READINESS.md §5 for the design and why: the router and the
 * CSRF code are byte-pinned, and recording the events needs a new table). Fail-closed: without a signing secret nothing is ever accepted.
 *
 * Resend signs webhooks with Svix (resend.com/docs/dashboard/webhooks/verify-webhooks-requests, docs.svix.com « verifying payloads manually », read 3 Nov 2026):
 *   headers svix-id, svix-timestamp (seconds), svix-signature (space-separated « v1,<base64> » entries);
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}` (the raw bytes, before any JSON parsing);
 *   key = base64-decode(secret without its « whsec_ » prefix); signature = base64(HMAC-SHA256(key, signed content)); constant-time comparison;
 *   a timestamp outside the tolerance is refused (replay).
 */
import crypto from 'node:crypto';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** @param {Record<string, unknown> | Headers | null | undefined} headers @param {string} name */
function header(headers, name) {
  if (!headers) return '';
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) || '';
  const v = Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  return Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '';
}

/**
 * @param {{ rawBody: string | Buffer, headers: Record<string, unknown> | Headers, secret: string | undefined | null, nowSeconds?: number, toleranceSeconds?: number }} input
 * @returns {{ ok: true, event: any } | { ok: false, reason: 'NOT_CONFIGURED' | 'BAD_SECRET' | 'MISSING_HEADERS' | 'STALE' | 'BAD_SIGNATURE' | 'BAD_PAYLOAD' }}
 */
export function verifyResendWebhook({ rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS }) {
  const s = typeof secret === 'string' ? secret.trim() : '';
  if (!s) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (!s.startsWith('whsec_')) return { ok: false, reason: 'BAD_SECRET' };
  const key = Buffer.from(s.slice('whsec_'.length), 'base64');
  if (key.length < 16) return { ok: false, reason: 'BAD_SECRET' };
  const id = header(headers, 'svix-id'); const ts = header(headers, 'svix-timestamp'); const sig = header(headers, 'svix-signature');
  if (!id || !ts || !sig) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!/^\d{1,12}$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > toleranceSeconds) return { ok: false, reason: 'STALE' };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const expected = crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from(`${id}.${ts}.`, 'utf8'), body])).digest();
  const match = sig.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!match) return { ok: false, reason: 'BAD_SIGNATURE' };
  try { return { ok: true, event: JSON.parse(body.toString('utf8')) }; } catch { return { ok: false, reason: 'BAD_PAYLOAD' }; }
}

/**
 * The address-free summary of one verified event — what may be stored or logged: the type, Resend's e-mail id, and what it means for future sends.
 * `suppress` is true for a permanent bounce, a complaint and a suppressed address: the address should not be written to again (by the future suppression list).
 * @param {any} event @returns {{ type: string, emailId: string | null, kind: string, suppress: boolean }}
 */
export function mailEventSummary(event) {
  const type = typeof event?.type === 'string' && /^[a-z_.]{1,40}$/.test(event.type) ? event.type : 'unknown';
  const rawId = event?.data?.email_id;
  const emailId = typeof rawId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(rawId) ? rawId : null;
  const bounceType = event?.data?.bounce?.type;
  const kind = type === 'email.bounced' ? (bounceType === 'Permanent' ? 'bounce_permanent' : 'bounce_temporary')
    : type === 'email.complained' ? 'complaint' : type === 'email.delivered' ? 'delivered' : type === 'email.delivery_delayed' ? 'delayed'
      : type === 'email.failed' ? 'failed' : type === 'email.suppressed' ? 'suppressed' : type === 'email.sent' ? 'sent' : 'other';
  return { type, emailId, kind, suppress: kind === 'bounce_permanent' || kind === 'complaint' || kind === 'suppressed' };
}
