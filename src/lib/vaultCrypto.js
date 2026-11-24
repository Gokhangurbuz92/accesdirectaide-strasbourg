// @ts-check
/**
 * G14-R3 — END-TO-END encryption of Mon Coffre (owner 24/11/2026). Everything is encrypted IN THE BROWSER before it reaches the HDS service; neither
 * AccèsDirectAide (Vercel / Neon), nor the HDS service, nor the host can open a document, its name, its category or its type.
 *
 *   passphrase ──PBKDF2-SHA256, 600 000 iterations, 16-byte salt──► passphrase key (non-extractable)
 *   vault key  = 32 random bytes, stored only WRAPPED by the passphrase key (keyring, on the HDS service); in the page: a non-extractable CryptoKey
 *   per document: a random file key; content box = AES-GCM(file key, bytes); meta box = AES-GCM(file key, {name, category, type}); dek box = AES-GCM(vault key, file key)
 * Primitives: src/lib/passeport/crypto.js (WebCrypto only, no library).
 *
 * G14-R4 — RECOVERY, still zero-knowledge. At setup the browser draws a one-time RECOVERY CODE (25 characters of an unambiguous alphabet, ≈ 124 bits), shown
 * once (to print or download), never sent. It wraps the SAME vault key a second time (PBKDF2 with its own salt): keyring.recovery = { salt, iterations,
 * wrapped, verifier }. Forgotten passphrase → the code opens the vault key → a new passphrase AND a new code are set (the old code is spent). A passphrase
 * change re-wraps the same key. The service can refuse a silent replacement without ever seeing a key: keyring.authHash = SHA-256(authToken), where
 * authToken = SHA-256(« ada-vault-auth/v1 » ‖ vault key bytes); a replacement must present authToken (one-way: it reveals nothing of the key).
 * Losing BOTH the passphrase and the code still means the documents are lost (stated to the person).
 */
import { checkVerifier, CODE_ALPHABET, decryptBytes, decryptJson, deriveKey, encryptBytes, encryptJson, KDF_ITERATIONS, makeVerifier, normaliseExportCode, randomBytes, toB64, fromB64 } from './passeport/crypto.js';

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

const AUTH_LABEL = new TextEncoder().encode('ada-vault-auth/v1');
export const RECOVERY_CODE_LENGTH = 25;

/** the one-way proof that a browser holds the vault key (sent only to replace a keyring) @param {Uint8Array} raw @returns {Promise<string>} */
async function authTokenOf(raw) {
  const buf = new Uint8Array(AUTH_LABEL.length + raw.length); buf.set(AUTH_LABEL); buf.set(raw, AUTH_LABEL.length);
  const out = toB64(new Uint8Array(await subtle().digest('SHA-256', /** @type {BufferSource} */ (/** @type {unknown} */ (buf)))));
  buf.fill(0);
  return out;
}
/** @param {string} token @returns {Promise<string>} */
const hashOf = async (token) => toB64(new Uint8Array(await subtle().digest('SHA-256', /** @type {BufferSource} */ (/** @type {unknown} */ (fromB64(token))))));

/** a one-time recovery code: 25 characters (≈ 124 bits), grouped by 5 — shown once, never stored nor sent */
export function newRecoveryCode() {
  const b = randomBytes(RECOVERY_CODE_LENGTH);
  const raw = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  b.fill(0);
  return raw.match(/.{5}/g)?.join('-') || raw;
}
/** @param {string} code */
export const normaliseRecoveryCode = (code) => normaliseExportCode(code);

/** @param {Uint8Array} raw @param {string} secret @param {number} iterations */
async function wrapWith(raw, secret, iterations) {
  const salt = randomBytes(16);
  const kek = await deriveKey(secret, salt, iterations);
  return { salt: toB64(salt), iterations, wrapped: await encryptBytes(kek, raw), verifier: await makeVerifier(kek) };
}

/** a keyring for a vault key: passphrase wrap, recovery wrap, auth hash @param {Uint8Array} raw @param {string} passphrase @param {string} recoveryCode @param {number} iterations */
async function keyringFor(raw, passphrase, recoveryCode, iterations) {
  const p = await wrapWith(raw, passphrase, iterations);
  const r = await wrapWith(raw, normaliseRecoveryCode(recoveryCode), iterations);
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: p.salt, wrapped: p.wrapped, verifier: p.verifier,
    recovery: { iterations: r.iterations, salt: r.salt, wrapped: r.wrapped, verifier: r.verifier }, authHash: await hashOf(await authTokenOf(raw)) };
}

/**
 * a new vault: a random vault key, wrapped by the passphrase AND by a fresh recovery code (returned once, to show)
 * @param {string} passphrase @param {number} [iterations] @returns {Promise<{ keyring: any, vaultKey: CryptoKey, recoveryCode: string, authToken: string }>}
 */
export async function createKeyring(passphrase, iterations = KDF_ITERATIONS) {
  const raw = randomBytes(32);
  const recoveryCode = newRecoveryCode();
  const keyring = await keyringFor(raw, passphrase, recoveryCode, iterations);
  const vaultKey = await importAes(raw); const authToken = await authTokenOf(raw);
  raw.fill(0);
  return { keyring, vaultKey, recoveryCode, authToken };
}

/** @param {{ salt: string, iterations: number, wrapped: any, verifier: any }} w @param {string} secret @returns {Promise<Uint8Array | null>} */
async function openWrap(w, secret) {
  const kek = await deriveKey(secret, fromB64(w.salt), w.iterations);
  if (!(await checkVerifier(kek, w.verifier))) return null;
  return decryptBytes(kek, w.wrapped);
}

/** null = wrong passphrase @param {any} keyring @param {string} passphrase @returns {Promise<CryptoKey | null>} */
export async function unlockKeyring(keyring, passphrase) {
  const out = await unlockKeyringFull(keyring, passphrase);
  return out ? out.vaultKey : null;
}
/** the vault key and its replacement proof; null = wrong passphrase @param {any} keyring @param {string} passphrase */
export async function unlockKeyringFull(keyring, passphrase) {
  const raw = await openWrap(keyring, passphrase);
  if (!raw) return null;
  const out = { vaultKey: await importAes(raw), authToken: await authTokenOf(raw) };
  raw.fill(0);
  return out;
}

/**
 * passphrase change (the person is unlocked with the CURRENT passphrase): the same vault key, a new passphrase wrap; the recovery wrap is kept
 * @param {any} keyring @param {string} currentPassphrase @param {string} newPassphrase @param {number} [iterations]
 * @returns {Promise<{ keyring: any, authToken: string } | null>} null = wrong current passphrase
 */
export async function changePassphrase(keyring, currentPassphrase, newPassphrase, iterations = KDF_ITERATIONS) {
  const raw = await openWrap(keyring, currentPassphrase);
  if (!raw) return null;
  const p = await wrapWith(raw, newPassphrase, iterations);
  const authToken = await authTokenOf(raw);
  raw.fill(0);
  return { keyring: { ...keyring, iterations: p.iterations, salt: p.salt, wrapped: p.wrapped, verifier: p.verifier, authHash: keyring.authHash || await hashOf(authToken) }, authToken };
}

/**
 * a NEW recovery code for an unlocked vault (the previous one stops working); needs the current passphrase
 * @param {any} keyring @param {string} passphrase @param {number} [iterations]
 * @returns {Promise<{ keyring: any, authToken: string, recoveryCode: string } | null>}
 */
export async function renewRecoveryCode(keyring, passphrase, iterations = KDF_ITERATIONS) {
  const raw = await openWrap(keyring, passphrase);
  if (!raw) return null;
  const recoveryCode = newRecoveryCode();
  const next = await keyringFor(raw, passphrase, recoveryCode, iterations);
  const authToken = await authTokenOf(raw);
  raw.fill(0);
  return { keyring: next, authToken, recoveryCode };
}

/**
 * forgotten passphrase: the recovery code opens the vault key; a new passphrase AND a new recovery code are set (the used code is spent)
 * @param {any} keyring @param {string} recoveryCode @param {string} newPassphrase @param {number} [iterations]
 * @returns {Promise<{ keyring: any, vaultKey: CryptoKey, authToken: string, recoveryCode: string } | null>} null = wrong code (or no recovery set up)
 */
export async function recoverWithCode(keyring, recoveryCode, newPassphrase, iterations = KDF_ITERATIONS) {
  if (!keyring?.recovery) return null;
  const raw = await openWrap(keyring.recovery, normaliseRecoveryCode(recoveryCode));
  if (!raw) return null;
  const nextCode = newRecoveryCode();
  const next = await keyringFor(raw, newPassphrase, nextCode, iterations);
  const out = { keyring: next, vaultKey: await importAes(raw), authToken: await authTokenOf(raw), recoveryCode: nextCode };
  raw.fill(0);
  return out;
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
