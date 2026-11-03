/**
 * R41-B — the « already booked » answer of an account-free hold (R39: one active booking per structure and address, without enumeration) is a REAL hold row
 * without any personal data: a decoy. It holds its slot, replays, counts wrong codes, locks, expires and is purged through the same code and the same
 * database rules as a real hold, so a requester cannot tell « this address already has an active booking here » from « a hold was created » — not from the
 * answer, the slot list, a second hold on the slot, a retry, confirm, or a missing KV store (R40 finding: the decoy inserted nothing and kept its confirm state
 * in KV).
 *
 * A decoy row:
 *   - beneficiaryName = GUEST_DECOY_NAME (the marker; a column that exists from migration 0000, so a reader's exclusion works on a 0042 database too, where
 *     no decoy can exist); a real guest name is always sealed (encrypted), and the account-free form refuses « [ ] » in a name;
 *   - no address, no phone, no note, no name, no consent to mails, no citizen, no professional author;
 *   - guestEmailHash = guestDecoyLookupHash(): never the address's blind index (so no per-address rule or lookup ever finds it, and it is « active » for
 *     nobody); a keyed digest of that blind index, the structure and the request's idempotency key, only so that the SAME request retried finds the same
 *     decoy (R38 idempotency) — it cannot be linked to an address without both the server secret and the requester's idempotency key;
 *   - guestCodeHash = an unusable value (never the 64-hex HMAC that checkGuestCode compares): no code ever confirms it, and confirm refuses a decoy anyway.
 * Readers that must not show or count it (structure statistics, reports, the absence conflict list) use notGuestDecoy / notGuestDecoySql. The professional
 * agenda and the J-1 reminder already leave out every unconfirmed hold (guestHoldExpiresAt IS NOT NULL), and a decoy is never confirmed.
 */
import crypto from 'node:crypto';
import { ne, sql } from 'drizzle-orm';

/** the marker of a decoy hold, stored in ProAppointment.beneficiaryName (never a sealed value: sealed values are « v1:… ») */
export const GUEST_DECOY_NAME = '[r41:guest-decoy]';

/**
 * the per-request lookup value stored in guestEmailHash of a decoy
 * @param {string} emailHash the address's blind index (guestEmailHash(), an HMAC under the server secret)
 * @param {string} structureId
 * @param {string} idempotencyKey
 * @returns {string} 64 hex characters, like a blind index
 */
export function guestDecoyLookupHash(emailHash, structureId, idempotencyKey) {
  return crypto.createHmac('sha256', String(emailHash)).update(`r41-guest-decoy\u0000${structureId}\u0000${idempotencyKey}`, 'utf8').digest('hex');
}

/** a code hash no code can match (checkGuestCode compares a 64-hex digest in constant time; this value is never 64 characters long) @returns {string} */
export const unusableGuestCodeHash = () => `unusable:${crypto.randomBytes(16).toString('hex')}`;

/** @param {{ beneficiaryName?: unknown } | null | undefined} row */
export const isGuestDecoy = (row) => row?.beneficiaryName === GUEST_DECOY_NAME;

/**
 * drizzle condition « not a decoy » on the ProAppointment table (or an alias of it)
 * @param {{ beneficiaryName: import('drizzle-orm').Column }} t
 */
export const notGuestDecoy = (t) => ne(t.beneficiaryName, GUEST_DECOY_NAME);

/**
 * raw-SQL condition « not a decoy » for the given beneficiaryName column reference, e.g. notGuestDecoySql(sql`a."beneficiaryName"`)
 * @param {import('drizzle-orm').SQL} column
 */
export const notGuestDecoySql = (column) => sql`${column} <> ${GUEST_DECOY_NAME}`;
