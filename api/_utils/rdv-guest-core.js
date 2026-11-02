// @ts-nocheck
/**
 * R38 — account-free (« sans compte ») booking: the pure rules (no database, no network), unit-tested in tests/unit/r38-guest-booking-core.test.js.
 *   - the global switch (fail-closed): ADA_GUEST_BOOKING_ENABLED must be exactly « true »;
 *   - the mail truthfulness rule: only PROVIDER_ACCEPTED (a real provider took it) or TEST_RECORDED (LAB test outbox) count as sent — never noop;
 *   - the 6-digit code (HMAC bound to the hold, never stored in clear), the manage token (32 random bytes, only its SHA-256 stored), constant-time checks;
 *   - the e-mail blind index (HMAC, so a list of hashes cannot be reversed with a dictionary of addresses);
 *   - input validation of the minimal identity, and masking (an address or a phone is never echoed back in clear).
 */
import crypto from 'node:crypto';

export const GUEST_HOLD_MINUTES = 20;
export const GUEST_CODE_MAX_ATTEMPTS = 5;
export const GUEST_NOTE_MAX = 300;
export const GUEST_NAME_MAX = 80;
const PROCESS_LOCAL_SECRET = crypto.randomBytes(32);

/** @param {Record<string, string | undefined>} [envVars] */
export function guestBookingEnabled(envVars = process.env) {
  return String(envVars.ADA_GUEST_BOOKING_ENABLED || '').trim().toLowerCase() === 'true';
}

/** a sendMail() result really left (or was recorded by the LAB test outbox); `accepted` alone is also true for noop @param {{ outcome?: string } | null | undefined} out */
export function mailReallySent(out) {
  return out?.outcome === 'PROVIDER_ACCEPTED' || out?.outcome === 'TEST_RECORDED';
}

function secret(envVars = process.env) {
  const configured = [envVars.RDV_CONFIRMATION_TOKEN_SECRET, envVars.AUTH_SECRET, envVars.JWT_SECRET, envVars.SESSION_SECRET]
    .find((v) => typeof v === 'string' && v.length >= 32);
  if (configured) return Buffer.from(configured, 'utf8');
  if (envVars.NODE_ENV === 'production') throw new Error('A durable secret of at least 32 characters is required for account-free booking');
  return PROCESS_LOCAL_SECRET;
}
const hmac = (label, value, envVars) => crypto.createHmac('sha256', secret(envVars)).update(`${label}\u0000${value}`, 'utf8').digest('hex');

/** lower-case, trimmed; null when it is not an address @param {unknown} value */
export function normalizeGuestEmail(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(v)) return null;
  return v;
}

/** blind index of the address (per-address limits, idempotency) @param {string} email */
export const guestEmailHash = (email, envVars = process.env) => hmac('r38-guest-email', normalizeGuestEmail(email) || '', envVars);

/** a 6-digit code, uniform @returns {string} */
export const newGuestCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
/** the stored form of a code, bound to its hold (a code of hold A never matches hold B) @param {string} holdId @param {string} code */
export const guestCodeHash = (holdId, code, envVars = process.env) => hmac('r38-guest-code', `${holdId}:${code}`, envVars);

/** constant-time equality of two hex digests of the same length */
export function sameDigest(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'); const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** @param {string} holdId @param {unknown} code @param {string | null | undefined} storedHash */
export function checkGuestCode(holdId, code, storedHash, envVars = process.env) {
  const c = String(code ?? '').trim();
  if (!/^\d{6}$/.test(c) || !storedHash) return false;
  return sameDigest(guestCodeHash(holdId, c, envVars), storedHash);
}

/** a high-entropy manage token (256 bits) and the only thing stored about it */
export function newManageToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: manageTokenHash(token) };
}
/** @param {string} token */
export const manageTokenHash = (token) => `sha256:${crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')}`;

/** the manage token is valid for THIS appointment until its end @param {unknown} token @param {{ guestManageTokenHash?: string | null, guestManageExpiresAt?: Date | string | null }} row @param {Date} [now] */
export function checkManageToken(token, row, now = new Date()) {
  const t = String(token ?? '').trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(t) || !row?.guestManageTokenHash || !row?.guestManageExpiresAt) return false;
  if (new Date(row.guestManageExpiresAt).getTime() <= now.getTime()) return false;
  return sameDigest(manageTokenHash(t), row.guestManageTokenHash);
}

/** @param {{ guestHoldExpiresAt?: Date | string | null }} row @param {Date} [now] */
export const holdExpired = (row, now = new Date()) => !row?.guestHoldExpiresAt || new Date(row.guestHoldExpiresAt).getTime() <= now.getTime();
export const holdExpiry = (now = new Date()) => new Date(now.getTime() + GUEST_HOLD_MINUTES * 60_000);

/** « ma***@exemple.fr » @param {string | null | undefined} email */
export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return null;
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}***@${domain}`;
}
/** « ** ** ** ** 78 » @param {string | null | undefined} phone */
export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-2)}` : null;
}

/**
 * The minimal identity of an account-free booking. Returns { value } or { error: { code, field } }.
 * name: a name or initials (1-80 chars, no digits); email required; phone optional; consent to the booking e-mails required; note optional, at most 300 chars.
 * @param {any} body
 */
export function readGuestIdentity(body) {
  const b = body && typeof body === 'object' ? body : {};
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > GUEST_NAME_MAX || /[\d<>{}[\]@]/.test(name)) return { error: { code: 'INVALID_NAME', field: 'name' } };
  const email = normalizeGuestEmail(b.email);
  if (!email) return { error: { code: 'INVALID_EMAIL', field: 'email' } };
  let phone = null;
  if (b.phone !== undefined && b.phone !== null && String(b.phone).trim() !== '') {
    const p = String(b.phone).replace(/[\s.-]/g, '');
    if (!/^\+?\d{6,15}$/.test(p)) return { error: { code: 'INVALID_PHONE', field: 'phone' } };
    phone = p;
  }
  if (b.consent !== true) return { error: { code: 'CONSENT_REQUIRED', field: 'consent' } };
  const note = String(b.note ?? '').trim();
  if (note.length > GUEST_NOTE_MAX) return { error: { code: 'NOTE_TOO_LONG', field: 'note' } };
  return { value: { name, email, phone, note: note || null } };
}
