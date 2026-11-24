// @ts-check
/**
 * G14-R3 — END-TO-END encryption of Mon Coffre (owner 24/11/2026). Everything is encrypted IN THE BROWSER before it reaches the HDS service; neither
 * AccèsDirectAide (Vercel / Neon), nor the HDS service, nor the host can open a document, its name, its category or its type.
 *
 *   passphrase ──PBKDF2-SHA256, 600 000 iterations, 16-byte salt──► passphrase key (non-extractable)
 *   vault key  = 32 random bytes, stored only WRAPPED by the passphrase key (keyring, on the HDS service); in the page: a non-extractable CryptoKey
 *   per document: a random file key; content box = AES-GCM(file key, bytes); meta box = AES-GCM(file key, {name, category, type}); dek box = AES-GCM(vault key, file key)
 * A forgotten passphrase cannot be recovered by anyone (stated to the person). Primitives: src/lib/passeport/crypto.js (WebCrypto only, no library).
 */
import { checkVerifier, decryptBytes, decryptJson, deriveKey, encryptBytes, encryptJson, KDF_ITERATIONS, makeVerifier, randomBytes, toB64, fromB64 } from './passeport/crypto.js';

export const VAULT_PASSPHRASE_MIN = 10;

/** @returns {SubtleCrypto} */
const subtle = () => /** @type {any} */ (globalThis).crypto.subtle;
/** @param {Uint8Array} raw @returns {Promise<CryptoKey>} */
const importAes = (raw) => subtle().importKey('raw', /** @type {BufferSource} */ (/** @type {unknown} */ (raw)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** the type comes from the CONTENT (magic bytes) — checked here because the HDS service only ever sees ciphertext @param {Uint8Array} b */
export function sniffType(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/** @param {string} passphrase @param {number} [iterations] @returns {Promise<{ keyring: any, vaultKey: CryptoKey }>} */
export async function createKeyring(passphrase, iterations = KDF_ITERATIONS) {
  const salt = randomBytes(16);
  const kek = await deriveKey(passphrase, salt, iterations);
  const raw = randomBytes(32);
  const wrapped = await encryptBytes(kek, raw);
  const vaultKey = await importAes(raw);
  raw.fill(0);
  return { keyring: { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), wrapped, verifier: await makeVerifier(kek) }, vaultKey };
}

/** null = wrong passphrase @param {any} keyring @param {string} passphrase @returns {Promise<CryptoKey | null>} */
export async function unlockKeyring(keyring, passphrase) {
  const kek = await deriveKey(passphrase, fromB64(keyring.salt), keyring.iterations);
  if (!(await checkVerifier(kek, keyring.verifier))) return null;
  const raw = await decryptBytes(kek, keyring.wrapped);
  const key = await importAes(raw);
  raw.fill(0);
  return key;
}

/** @param {CryptoKey} vaultKey @param {{ bytes: Uint8Array, name: string, category: string, type: string }} doc */
export async function encryptDocument(vaultKey, doc) {
  const raw = randomBytes(32);
  const fileKey = await importAes(raw);
  const out = { content: await encryptBytes(fileKey, doc.bytes), meta: await encryptJson(fileKey, { name: doc.name, category: doc.category, type: doc.type }), dek: await encryptBytes(vaultKey, raw) };
  raw.fill(0);
  return out;
}

/** @param {CryptoKey} vaultKey @param {{ dek: { iv: string, ct: string } }} doc */
async function fileKeyOf(vaultKey, doc) {
  const raw = await decryptBytes(vaultKey, doc.dek);
  const key = await importAes(raw);
  raw.fill(0);
  return key;
}

/** @param {CryptoKey} vaultKey @param {{ dek: any, meta: any }} doc @returns {Promise<{ name: string, category: string, type: string }>} */
export async function openMeta(vaultKey, doc) {
  return decryptJson(await fileKeyOf(vaultKey, doc), doc.meta);
}

/** @param {CryptoKey} vaultKey @param {{ dek: any }} doc @param {{ iv: string, ct: string }} content @returns {Promise<Uint8Array>} */
export async function openContent(vaultKey, doc, content) {
  return decryptBytes(await fileKeyOf(vaultKey, doc), content);
}
