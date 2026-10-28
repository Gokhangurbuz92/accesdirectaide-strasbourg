// @ts-check
/**
 * Owner LAB audit — one-time codes are used ONCE, and professional TOTP seeds are sealed at rest.
 *   - claimAdminStep / claimProStep: the 30-second time step of an accepted code is recorded with a compare-and-set; a code of the same or an earlier step is
 *     then refused (RFC 6238 §5.2 — a code seen over a shoulder, in a screenshot or by a proxy can no longer be replayed within its 30–90 s validity window).
 *     The step is shared by sign-in and elevation: an elevation needs a code the person has not used yet.
 *   - sealMfaSecret / openMfaSecret: a professional seed is stored « v1:<iv>:<ciphertext>:<tag> » (AES-256-GCM, the vault that already seals administrator
 *     seeds); a seed written before (plain base32) is still read, and is replaced by a sealed one at the next enrolment.
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { AdminUser, ProUser } from '../../src/db/schema.js';
import { decryptToken, encryptToken, isVaultReady } from './vault.js';

const SEALED = 'v1:';

/** @param {string} secret base32 seed @returns {string} */
export function sealMfaSecret(secret) {
  const { content, iv } = encryptToken(secret);
  return `${SEALED}${iv}:${content}`;
}

/** @param {string | null | undefined} stored @returns {string | null} the base32 seed, or null when absent or unreadable (wrong key, tampered) */
export function openMfaSecret(stored) {
  if (!stored) return null;
  if (!stored.startsWith(SEALED)) return stored;
  const [iv, cipher, tag] = stored.slice(SEALED.length).split(':');
  try { return decryptToken(`${cipher}:${tag}`, iv); } catch { return null; }
}

export { isVaultReady };

/** @param {any} db @param {string} adminId @param {number} step @returns {Promise<boolean>} false when this step (or a later one) was already used */
export async function claimAdminStep(db, adminId, step) {
  if (!Number.isInteger(step)) return false;
  const rows = await db.update(AdminUser).set({ mfaLastTimeStep: step })
    .where(and(eq(AdminUser.id, adminId), or(isNull(AdminUser.mfaLastTimeStep), lt(AdminUser.mfaLastTimeStep, step)))).returning({ id: AdminUser.id });
  return rows.length === 1;
}

/** @param {any} db @param {string} proUserId @param {number} step @returns {Promise<boolean>} */
export async function claimProStep(db, proUserId, step) {
  if (!Number.isInteger(step)) return false;
  const rows = await db.update(ProUser).set({ mfa_last_time_step: step })
    .where(and(eq(ProUser.id, proUserId), or(isNull(ProUser.mfa_last_time_step), lt(ProUser.mfa_last_time_step, step)))).returning({ id: ProUser.id });
  return rows.length === 1;
}
