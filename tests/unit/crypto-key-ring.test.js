/**
 * Launch-readiness item 61 — the v1 format (api/lib/crypto.ts: appointment conversation messages, appointment contact snapshots, legacy files) reads with the
 * whole key ring: after a new primary key is promoted the old values stay readable while the old key is kept decrypt-only, they can be re-encrypted with the
 * primary, and without the old key the read fails closed. Synthetic keys only.
 */
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { bufferKeyIndex, decrypt, decryptBuffer, encrypt, encryptBuffer, isV1Text, reencryptBuffer, reencryptV1, v1KeyIndex } from '../../api/lib/crypto.js';

const A = crypto.randomBytes(32).toString('hex');
const B = crypto.randomBytes(32).toString('hex');
const ORIG = { key: process.env.ADA_ENCRYPTION_KEY, prev: process.env.ADA_ENCRYPTION_KEY_PREVIOUS };
const ring = (primary, previous = '') => { process.env.ADA_ENCRYPTION_KEY = primary; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = previous; };
afterEach(() => { process.env.ADA_ENCRYPTION_KEY = ORIG.key; if (ORIG.prev === undefined) delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; else process.env.ADA_ENCRYPTION_KEY_PREVIOUS = ORIG.prev; });

describe('v1 key ring', () => {
  it('survives a rotation: readable with the old key decrypt-only, re-encrypted with the new primary, fail-closed once the old key is gone', () => {
    ring(A);
    const old = encrypt('message du rendez-vous');
    const oldBuf = encryptBuffer(Buffer.from('fichier joint'));
    expect([v1KeyIndex(old), bufferKeyIndex(oldBuf)]).toEqual([0, 0]);

    ring(B, A);   // rotation: B is the primary, A may only decrypt
    expect(decrypt(old)).toBe('message du rendez-vous');
    expect(decryptBuffer(oldBuf).toString()).toBe('fichier joint');
    expect([v1KeyIndex(old), bufferKeyIndex(oldBuf)]).toEqual([1, 1]);
    const next = reencryptV1(old); const nextBuf = reencryptBuffer(oldBuf);
    expect([v1KeyIndex(next), bufferKeyIndex(nextBuf)]).toEqual([0, 0]);

    ring(B);      // A retired
    expect(decrypt(next)).toBe('message du rendez-vous');
    expect(decryptBuffer(nextBuf).toString()).toBe('fichier joint');
    expect(() => decrypt(old)).toThrow(/Decryption failed/);
    expect(() => decryptBuffer(oldBuf)).toThrow(/Decryption failed/);
    expect([v1KeyIndex(old), bufferKeyIndex(oldBuf)]).toEqual([-1, -1]);
  });
  it('recognises only the v1 / legacy shapes (plain values are not encrypted values)', () => {
    ring(A);
    expect(isV1Text(encrypt('x'))).toBe(true);
    for (const v of ['Particulier', '[anonymisé]', 'v2:abc:01:x:y', '', null, 42]) expect(isV1Text(v), String(v)).toBe(false);
    expect(v1KeyIndex('Particulier')).toBe(-1);
  });
});
