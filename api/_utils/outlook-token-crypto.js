import crypto from 'node:crypto';
import { env } from './env.js';

/**
 * AES-256-GCM envelope for Outlook OAuth tokens stored in ProOutlookToken.{accessTokenEnc,refreshTokenEnc}: `ivHex:tagHex:cipherHex`
 * (same format as api/_handlers/pro/outlook.js). STRICT: no plaintext fallback — without a 32+ char key it throws instead of storing or accepting clear tokens.
 */
function key() {
  const k = env.outlook.tokenEncryptionKey || '';
  if (k.length < 32) throw new Error('Outlook token encryption key is required');
  return Buffer.from(k.slice(0, 32), 'utf8');
}

/** @param {string} text @returns {string} */
export function encryptToken(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

/** @param {string} data @returns {string} */
export function decryptToken(data) {
  const parts = typeof data === 'string' ? data.split(':') : [];
  if (parts.length !== 3 || !/^[0-9a-f]{24}$/i.test(parts[0]) || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^[0-9a-f]*$/i.test(parts[2])) throw new Error('Malformed Outlook token envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[0], 'hex'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return decipher.update(Buffer.from(parts[2], 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

/** iv column value for an envelope. @param {string} envelope */
export const envelopeIv = (envelope) => envelope.split(':')[0];
