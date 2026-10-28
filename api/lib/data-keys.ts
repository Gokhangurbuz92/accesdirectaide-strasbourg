/**
 * Envelope encryption v2 (server-side, "encryption at rest" - NOT end-to-end).
 *
 *  - Every record gets its OWN random 256-bit data key (DEK), independent of any identifier (shareId, threadId, ...).
 *  - The DEK is wrapped (AES-256-GCM) with a purpose sub-key derived from the master key by HKDF-SHA256 (info "ada/data-key/v2/<purpose>"):
 *    messages, files and file names never share a key, and the master key is never used directly on data.
 *  - Both the wrapping and the payload are authenticated with AAD = purpose + caller-supplied context (e.g. "thread:<id>", "file:<dossier>:<file>"), so a ciphertext
 *    copied to another row / dossier / purpose fails authentication instead of decrypting.
 *  - Key ring with key ids: ADA_ENCRYPTION_KEY is the primary; ADA_ENCRYPTION_KEY_PREVIOUS (comma separated hex) may only DECRYPT.  Rotation = promote a new primary,
 *    keep the old one in PREVIOUS, run scripts/rc5-rewrap-keys.mjs (re-wraps the DEK only, the payload is untouched), then retire the old key.
 *  - Primitives: Node's OpenSSL AES-256-GCM, HKDF and CSPRNG only. No custom cryptography.
 *  - Legacy "v1:" / unprefixed values (single static key, no AAD) stay readable through api/lib/crypto.ts and are never written again by the dossier code.
 *
 * TRUST BOUNDARY (honest): the application server holds the master key and can decrypt everything. This protects against database / backup / storage disclosure and
 * against cross-row ciphertext substitution; it does NOT hide content from the operator or from a compromised application server. The master key currently comes from an
 * environment variable: a managed KMS/HSM (envelope KEK held outside the app) is a release blocker for production, see RC5_PRIVACY_SECURITY_UX_PRODUCT_CONTRACT.md.
 */
import crypto from 'node:crypto';
import { env } from '../_utils/env.js';
import { decrypt as decryptLegacyText, decryptBuffer as decryptLegacyBuffer } from './crypto.js';

export type Purpose = 'dossier-message' | 'dossier-file' | 'dossier-filename' | 'coffre-file' | 'coffre-filename' | 'case-note' | 'referral-message' | 'message-attachment' | 'message-attachment-name' | 'support-request' | 'ownership-recovery' | 'diagnostic-situation' | 'email-change' | 'push-subscription';
// PKG-4: case notes and referral messages have their own purposes (a note can never be opened as a referral message, a dossier file, etc.)
// PKG-2: Mon Coffre has its own purposes (keys derived per purpose + context: a Coffre blob can never be opened as a dossier file and vice versa)
const PURPOSE_CODE: Record<Purpose, string> = { 'dossier-message': 'm', 'dossier-file': 'f', 'dossier-filename': 'n', 'coffre-file': 'c', 'coffre-filename': 'k', 'case-note': 'q', 'referral-message': 'r', 'message-attachment': 'a', 'message-attachment-name': 'b', 'support-request': 's', 'ownership-recovery': 'o', 'diagnostic-situation': 'd', 'email-change': 'e', 'push-subscription': 'p' };
const CODE_PURPOSE: Record<string, Purpose> = { m: 'dossier-message', f: 'dossier-file', n: 'dossier-filename', c: 'coffre-file', k: 'coffre-filename', q: 'case-note', r: 'referral-message', a: 'message-attachment', b: 'message-attachment-name', s: 'support-request', o: 'ownership-recovery', d: 'diagnostic-situation', e: 'email-change', p: 'push-subscription' };
const IV_LEN = 12;
const TAG_LEN = 16;
const BUF_MAGIC = Buffer.from('ADA2');

type Ring = { primaryKid: string; keys: Map<string, Buffer> };

const kidOf = (key: Buffer): string => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

function parseKey(hex: string): Buffer {
  const k = Buffer.from(hex.trim(), 'hex');
  if (k.length !== 32) throw new Error('data-keys: encryption keys must be 32 bytes (64 hex chars)');
  return k;
}

/** Built on every call from the environment (cheap) so rotation in tests / ops does not require a process restart of this module. */
function ring(): Ring {
  const primaryHex = env.secrets.adaEncryptionKey;
  if (!primaryHex) throw new Error('data-keys: ADA_ENCRYPTION_KEY is required');
  const primary = parseKey(primaryHex);
  const keys = new Map<string, Buffer>([[kidOf(primary), primary]]);
  for (const hex of String(process.env.ADA_ENCRYPTION_KEY_PREVIOUS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const k = parseKey(hex);
    keys.set(kidOf(k), k);
  }
  return { primaryKid: kidOf(primary), keys };
}

export const currentKeyId = (): string => ring().primaryKid;

function subKey(master: Buffer, purpose: Purpose): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), `ada/data-key/v2/${purpose}`, 32));
}

const b64u = (b: Buffer): string => b.toString('base64url');
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');
const aad = (kind: 'wrap' | 'data', purpose: Purpose, context: string): Buffer => Buffer.from(`ada.v2|${kind}|${purpose}|${context}`, 'utf8');

function gcmSeal(key: Buffer, plaintext: Buffer, additional: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  c.setAAD(additional);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function gcmOpen(key: Buffer, sealed: Buffer, additional: Buffer): Buffer {
  if (sealed.length < IV_LEN + TAG_LEN) throw new Error('data-keys: truncated ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV_LEN), { authTagLength: TAG_LEN });
  d.setAAD(additional);
  d.setAuthTag(sealed.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([d.update(sealed.subarray(IV_LEN + TAG_LEN)), d.final()]);
}

function wrapDek(purpose: Purpose, context: string, dek: Buffer, master: Buffer): Buffer {
  return gcmSeal(subKey(master, purpose), dek, aad('wrap', purpose, context));
}

function unwrapDek(purpose: Purpose, context: string, wrapped: Buffer, kid: string): Buffer {
  const master = ring().keys.get(kid);
  if (!master) throw new Error('data-keys: unknown key id (key retired or not configured)');
  return gcmOpen(subKey(master, purpose), wrapped, aad('wrap', purpose, context));
}

export interface SealOptions { purpose: Purpose; context: string }

/** Encrypts a UTF-8 string. Format: v2:<kid>:<purposeCode>:<b64u wrapped DEK>:<b64u iv|tag|ciphertext>. */
export function sealText(text: string, { purpose, context }: SealOptions): string {
  if (!context) throw new Error('data-keys: context is required');
  const r = ring();
  const master = r.keys.get(r.primaryKid) as Buffer;
  const dek = crypto.randomBytes(32);
  const payload = gcmSeal(dek, Buffer.from(text, 'utf8'), aad('data', purpose, context));
  return `v2:${r.primaryKid}:${PURPOSE_CODE[purpose]}:${b64u(wrapDek(purpose, context, dek, master))}:${b64u(payload)}`;
}

/** Decrypts v2 values (fail closed: any mismatch of key id, purpose, context or tag throws) and falls back to the legacy v1 / unprefixed reader for old rows. */
export function openText(sealed: string, { purpose, context }: SealOptions): string | null {
  if (!sealed) return null;
  if (!sealed.startsWith('v2:')) return decryptLegacyText(sealed);
  const parts = sealed.split(':');
  if (parts.length !== 5) throw new Error('data-keys: malformed v2 value');
  const [, kid, code, wrapped, payload] = parts as [string, string, string, string, string];
  if (CODE_PURPOSE[code] !== purpose) throw new Error('data-keys: purpose mismatch');
  const dek = unwrapDek(purpose, context, fromB64u(wrapped), kid);
  return gcmOpen(dek, fromB64u(payload), aad('data', purpose, context)).toString('utf8');
}

/** True when a v2 value is wrapped by a key that is no longer the primary (candidate for rewrapText). */
export function needsRewrap(sealed: string): boolean {
  if (!sealed.startsWith('v2:')) return false;
  return sealed.split(':')[1] !== ring().primaryKid;
}

/** Key rotation: unwrap the DEK with the old key and wrap it with the primary key. The encrypted payload is NOT touched or re-encrypted. */
export function rewrapText(sealed: string, { purpose, context }: SealOptions): string {
  if (!sealed.startsWith('v2:')) throw new Error('data-keys: only v2 values can be rewrapped');
  const parts = sealed.split(':');
  if (parts.length !== 5) throw new Error('data-keys: malformed v2 value');
  const [, kid, code, wrapped, payload] = parts as [string, string, string, string, string];
  if (CODE_PURPOSE[code] !== purpose) throw new Error('data-keys: purpose mismatch');
  if (kid === ring().primaryKid) return sealed;
  const dek = unwrapDek(purpose, context, fromB64u(wrapped), kid);
  const r = ring();
  const master = r.keys.get(r.primaryKid) as Buffer;
  return `v2:${r.primaryKid}:${code}:${b64u(wrapDek(purpose, context, dek, master))}:${payload}`;
}

/** Encrypts bytes. Format: "ADA2" | kid(4) | wrappedLen(1) | wrapped DEK | iv | tag | ciphertext. */
export function sealBuffer(data: Buffer, { purpose, context }: SealOptions): Buffer {
  if (!context) throw new Error('data-keys: context is required');
  const r = ring();
  const master = r.keys.get(r.primaryKid) as Buffer;
  const dek = crypto.randomBytes(32);
  const wrapped = wrapDek(purpose, context, dek, master);
  const head = Buffer.concat([BUF_MAGIC, Buffer.from(r.primaryKid, 'hex'), Buffer.from([wrapped.length])]);
  return Buffer.concat([head, wrapped, gcmSeal(dek, data, aad('data', purpose, context))]);
}

export const isSealedBuffer = (buf: Buffer): boolean => buf.length > 9 && buf.subarray(0, 4).equals(BUF_MAGIC);

export function openBuffer(sealed: Buffer, { purpose, context }: SealOptions): Buffer {
  if (!isSealedBuffer(sealed)) return decryptLegacyBuffer(sealed);
  const kid = sealed.subarray(4, 8).toString('hex');
  const wlen = sealed.readUInt8(8);
  const wrapped = sealed.subarray(9, 9 + wlen);
  const dek = unwrapDek(purpose, context, wrapped, kid);
  return gcmOpen(dek, sealed.subarray(9 + wlen), aad('data', purpose, context));
}

/** Key id a v2 value or sealed blob is wrapped with ('legacy' for v1 / unprefixed values, which the rotation leaves to the legacy reader). */
export function keyIdOf(sealed: string | Buffer): string {
  if (Buffer.isBuffer(sealed)) return isSealedBuffer(sealed) ? sealed.subarray(4, 8).toString('hex') : 'legacy';
  return typeof sealed === 'string' && sealed.startsWith('v2:') ? (sealed.split(':')[1] || 'legacy') : 'legacy';
}
export const isPrimaryKeyId = (kid: string): boolean => kid === ring().primaryKid;

/**
 * PKG-5 key rotation for blobs: the DEK lives in the blob header, so re-wrapping a blob = new header (primary kid + DEK wrapped with the primary key) + the SAME
 * iv|tag|ciphertext. The payload is never decrypted to disk nor re-encrypted; authentication still binds purpose + context. Fails closed like openBuffer.
 */
export function rewrapBuffer(sealed: Buffer, { purpose, context }: SealOptions): Buffer {
  if (!isSealedBuffer(sealed)) throw new Error('data-keys: only v2 blobs can be rewrapped');
  const kid = sealed.subarray(4, 8).toString('hex');
  const r = ring();
  if (kid === r.primaryKid) return sealed;
  const wlen = sealed.readUInt8(8);
  const dek = unwrapDek(purpose, context, sealed.subarray(9, 9 + wlen), kid);
  const master = r.keys.get(r.primaryKid) as Buffer;
  const wrapped = wrapDek(purpose, context, dek, master);
  const head = Buffer.concat([BUF_MAGIC, Buffer.from(r.primaryKid, 'hex'), Buffer.from([wrapped.length])]);
  return Buffer.concat([head, wrapped, sealed.subarray(9 + wlen)]);
}
