/**
 * Password hash format of the accounts (people, professionals, administrators): `scrypt:<salt hex>:<key hex>`, N 16384, r 8, p 1, 64-byte key.
 * No database or environment import, so a command-line tool (scripts/admin-bootstrap.mjs) can hash without starting the application.
 */
import crypto from 'crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`scrypt:${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * @param {string} password
 * @returns {string}
 */
export function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

/**
 * @param {string} password
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;
  if (!passwordHash.startsWith('scrypt:')) return false;

  const [, salt, keyHex] = passwordHash.split(':');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else {
        const keyBuffer = Buffer.from(keyHex, 'hex');
        if (keyBuffer.length !== derivedKey.length) return resolve(false);
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      }
    });
  });
}
