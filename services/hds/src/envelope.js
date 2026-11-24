// @ts-check
/**
 * G14-R3 — envelope encryption of the HDS service (encryption at rest, per-object keys).
 *
 *   KEK  key-encryption keys from HDS_DATA_KEYS ("<kid>:<64 hex>,<kid>:<64 hex>", the FIRST is the active one for new objects; the others only decrypt,
 *        which is how a rotation works). They live only in the Scalingo environment of the HDS app, never in Vercel, Neon, the repository or a log.
 *   DEK  one random AES-256 key PER OBJECT (vault document, dossier, dossier file). It encrypts the object's bytes and its metadata (file name,
 *        category), and is stored only wrapped by a KEK. Deleting the row deletes the DEK: the ciphertext left in a backup cannot be opened once the
 *        backup rotates out AND the row is gone (crypto-shredding on top of the provider's own disk encryption).
 *
 * Format of a sealed value: 0x01 | iv (12) | tag (16) | ciphertext — AES-256-GCM, with an AAD naming the owner, the object and the field, so a value
 * copied to another row, owner or field does not open.
 */
import crypto from 'node:crypto';

const VERSION = 1;

/** @typedef {{ active: string, keys: Map<string, Buffer> }} Keyring */

/** @param {string | undefined} raw @returns {Keyring} */
export function parseKeyring(raw) {
  const keys = new Map();
  let active = '';
  for (const part of String(raw || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9_-]{1,32}):([0-9a-fA-F]{64})$/.exec(part);
    if (!m) throw new Error('HDS_DATA_KEYS_MALFORMED');
    if (keys.has(m[1])) throw new Error('HDS_DATA_KEYS_DUPLICATE_ID');
    keys.set(m[1], Buffer.from(m[2], 'hex'));
    if (!active) active = m[1];
  }
  if (!active) throw new Error('HDS_DATA_KEYS_ABSENT');
  return { active, keys };
}

/** @param {Buffer} key @param {Buffer} plaintext @param {string} aad @returns {Buffer} */
export function seal(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), ct]);
}

/** @param {Buffer} key @param {Buffer} sealed @param {string} aad @returns {Buffer} */
export function open(key, sealed, aad) {
  const b = Buffer.from(sealed);
  if (b.length < 29 || b[0] !== VERSION) throw new Error('SEALED_FORMAT');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(1, 13));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]);
}

/** a fresh data key, wrapped by the active KEK @param {Keyring} ring @param {string} aad @returns {{ dek: Buffer, kekId: string, wrapped: Buffer }} */
export function newDataKey(ring, aad) {
  const dek = crypto.randomBytes(32);
  const kek = /** @type {Buffer} */ (ring.keys.get(ring.active));
  return { dek, kekId: ring.active, wrapped: seal(kek, dek, `dek:${aad}`) };
}

/** @param {Keyring} ring @param {string} kekId @param {Buffer} wrapped @param {string} aad @returns {Buffer} */
export function unwrapDataKey(ring, kekId, wrapped, aad) {
  const kek = ring.keys.get(kekId);
  if (!kek) throw new Error('KEK_UNKNOWN');
  return open(kek, wrapped, `dek:${aad}`);
}

/** @param {Buffer} buf */
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
