import crypto from 'node:crypto';

/**
 * Constant-time check of a shared-diagnostic capability (the secret carried in the URL fragment) against the stored SHA-256 digest.
 * Fails closed on any malformed input.
 * @param {unknown} rawCapability
 * @param {string | null | undefined} expectedHash
 * @returns {boolean}
 */
export function verifyCapability(rawCapability, expectedHash) {
  const capability = String(rawCapability || '').trim();
  const stored = String(expectedHash || '').trim().toLowerCase();
  if (!capability || capability.length > 512 || !/^[a-f0-9]{64}$/.test(stored)) return false;
  const actual = crypto.createHash('sha256').update(capability, 'utf8').digest();
  const expected = Buffer.from(stored, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
