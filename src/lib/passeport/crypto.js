// @ts-check
/**
 * G14-PS — Passeport Social, LOCAL-FIRST cryptography (WebCrypto only; no library, no network).
 *
 * Why no HDS: the person's documents and situation summary are encrypted IN THE BROWSER and stored ONLY on the person's own device (IndexedDB). AccesDirectAide's
 * servers never receive, store or can read them: nothing here calls fetch / XMLHttpRequest / sendBeacon, and the key is derived from a passphrase that never
 * leaves the page. Nothing is hosted, so there is no hosting of health data (CSP L1111-8) — even if a person chooses to keep a medical paper here.
 *
 *   Key derivation: PBKDF2-HMAC-SHA-256, 600 000 iterations (OWASP 2023 minimum for PBKDF2-SHA256), 16-byte random salt. Argon2id would be preferable but is
 *   not offered by WebCrypto and the owner refused paid / heavy dependencies: PBKDF2 is the WebCrypto-native choice (stated in the report).
 *   Encryption: AES-GCM 256, a fresh 12-byte IV for every record, non-extractable CryptoKey (it can never be exported from the page).
 *   Passphrase check: a fixed « verifier » record decrypts only with the right key (AES-GCM authentication) — a wrong passphrase fails, nothing is decrypted.
 */

export const KDF_ITERATIONS = 600_000;
export const KDF_HASH = 'SHA-256';
export const VERIFIER_TEXT = 'ada-passeport-social:v1';
const enc = new TextEncoder();
const dec = new TextDecoder();

/** @returns {Crypto} */
function webcrypto() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (!c || !c.subtle) throw Object.assign(new Error('WebCrypto indisponible'), { code: 'NO_WEBCRYPTO' });
  return c;
}

/** @param {Uint8Array} bytes */
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @param {string} b64 */
export function fromB64(b64) {
  const s = atob(String(b64 || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
/** @param {number} n */
export const randomBytes = (n) => webcrypto().getRandomValues(new Uint8Array(n));

/**
 * @param {string} passphrase @param {Uint8Array} salt @param {number} [iterations]
 * @returns {Promise<CryptoKey>} a NON-extractable AES-GCM 256 key
 */
export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const subtle = webcrypto().subtle;
  const base = await subtle.importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt: /** @type {BufferSource} */ (/** @type {unknown} */ (salt)), iterations, hash: KDF_HASH }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** @param {CryptoKey} key @param {Uint8Array} bytes @returns {Promise<{ iv: string, ct: string }>} */
export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await webcrypto().subtle.encrypt({ name: 'AES-GCM', iv }, key, /** @type {BufferSource} */ (/** @type {unknown} */ (bytes))));
  return { iv: toB64(iv), ct: toB64(ct) };
}
/** @param {CryptoKey} key @param {{ iv: string, ct: string }} box @returns {Promise<Uint8Array>} throws (OperationError) with a wrong key or altered data */
export async function decryptBytes(key, box) {
  return new Uint8Array(await webcrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct)));
}
/** @param {CryptoKey} key @param {unknown} value */
export const encryptJson = (key, value) => encryptBytes(key, enc.encode(JSON.stringify(value)));
/** @param {CryptoKey} key @param {{ iv: string, ct: string }} box */
export const decryptJson = async (key, box) => JSON.parse(dec.decode(await decryptBytes(key, box)));

/** the encrypted verifier of a new vault @param {CryptoKey} key */
export const makeVerifier = (key) => encryptBytes(key, enc.encode(VERIFIER_TEXT));
/** true when the key opens the verifier @param {CryptoKey} key @param {{ iv: string, ct: string }} verifier */
export async function checkVerifier(key, verifier) {
  try { return dec.decode(await decryptBytes(key, verifier)) === VERIFIER_TEXT; } catch { return false; }
}

/** unambiguous alphabet of the one-time export code (no 0/O, 1/I/L) */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** a one-time export code: 20 characters (≈ 99 bits), grouped by 5 — shown once, never stored */
export function newExportCode() {
  const b = randomBytes(20);
  const raw = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  return raw.match(/.{5}/g)?.join('-') || raw;
}
/** @param {string} code */
export const normaliseExportCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** minimum passphrase rule (local only: the passphrase is never sent) @param {string} p */
export const passphraseProblem = (p) => (typeof p !== 'string' || p.length < 10 ? 'TOO_SHORT' : null);
