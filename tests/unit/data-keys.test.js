/**
 * Envelope encryption v2 (api/lib/data-keys.ts): per-record random data keys independent of any identifier, purpose key separation (HKDF), AAD binding,
 * key ids + rotation (re-wrap without touching the payload), fail-closed behaviour and backward-compatible reading of the legacy v1 format.
 * This is encryption at rest, NOT end-to-end encryption (see the module header).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sealText, openText, sealBuffer, openBuffer, rewrapText, needsRewrap, currentKeyId, isSealedBuffer } from '../../api/lib/data-keys.js';
import { encrypt, encryptBuffer } from '../../api/lib/crypto.js';

const K1 = '11'.repeat(32), K2 = '22'.repeat(32);
const opts = (context, purpose = 'dossier-message') => ({ purpose, context });
let saved;
beforeEach(() => { saved = { k: process.env.ADA_ENCRYPTION_KEY, p: process.env.ADA_ENCRYPTION_KEY_PREVIOUS }; process.env.ADA_ENCRYPTION_KEY = K1; delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; });
afterEach(() => { process.env.ADA_ENCRYPTION_KEY = saved.k; if (saved.p === undefined) delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; else process.env.ADA_ENCRYPTION_KEY_PREVIOUS = saved.p; });

describe('data-keys v2 envelope', () => {
  it('round-trips text; every seal uses a fresh random data key and IV (same plaintext, different ciphertext AND different wrapped key)', () => {
    const a = sealText('bonjour', opts('thread:t1')), b = sealText('bonjour', opts('thread:t1'));
    expect(openText(a, opts('thread:t1'))).toBe('bonjour'); expect(openText(b, opts('thread:t1'))).toBe('bonjour');
    expect(a).not.toBe(b); expect(a.split(':')[3]).not.toBe(b.split(':')[3]); expect(a).toMatch(/^v2:[0-9a-f]{8}:m:/); expect(a).not.toContain('bonjour');
  });
  it('is bound to its context and purpose: a ciphertext moved to another thread / dossier / purpose does not decrypt', () => {
    const a = sealText('secret', opts('thread:t1'));
    expect(() => openText(a, opts('thread:t2'))).toThrow();
    expect(() => openText(a, opts('thread:t1', 'dossier-filename'))).toThrow();
    const f = sealText('x.pdf', opts('file:d1:f1', 'dossier-filename'));
    expect(() => openText(f, opts('file:d1:f2', 'dossier-filename'))).toThrow();
    expect(() => sealText('x', { purpose: 'dossier-message', context: '' })).toThrow();
  });
  it('fails closed on tampering, truncation and malformed values', () => {
    const a = sealText('secret', opts('thread:t1')), p = a.split(':');
    const flip = (s) => s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');
    expect(() => openText([p[0], p[1], p[2], p[3], flip(p[4])].join(':'), opts('thread:t1'))).toThrow();   // payload
    expect(() => openText([p[0], p[1], p[2], flip(p[3]), p[4]].join(':'), opts('thread:t1'))).toThrow();   // wrapped data key
    expect(() => openText([p[0], '00000000', p[2], p[3], p[4]].join(':'), opts('thread:t1'))).toThrow();   // unknown key id
    expect(() => openText('v2:broken', opts('thread:t1'))).toThrow();
  });
  it('purpose keys are separated: the same context under another purpose cannot unwrap the data key', () => {
    const a = sealText('secret', opts('shared:ctx'));
    const swapped = a.split(':'); swapped[2] = 'n';                                                       // pretend it is a file name
    expect(() => openText(swapped.join(':'), opts('shared:ctx', 'dossier-filename'))).toThrow();
  });
  it('does not depend on any identifier: only the master key (via HKDF) and the random data key protect the content', () => {
    const a = sealText('secret', opts('thread:t1'));
    process.env.ADA_ENCRYPTION_KEY = K2;                                                                    // other master key (identifiers unchanged) => unreadable
    expect(() => openText(a, opts('thread:t1'))).toThrow();
  });
  it('rotation: previous key can still read, rewrap moves the data key to the new primary without touching the payload, then the old key can be retired', () => {
    const old = sealText('secret', opts('thread:t1')), oldKid = currentKeyId();
    process.env.ADA_ENCRYPTION_KEY = K2; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = K1;
    expect(currentKeyId()).not.toBe(oldKid);
    expect(openText(old, opts('thread:t1'))).toBe('secret'); expect(needsRewrap(old)).toBe(true);
    const re = rewrapText(old, opts('thread:t1'));
    expect(re.split(':')[1]).toBe(currentKeyId()); expect(re.split(':')[4]).toBe(old.split(':')[4]); expect(re.split(':')[3]).not.toBe(old.split(':')[3]); expect(needsRewrap(re)).toBe(false);
    expect(rewrapText(re, opts('thread:t1'))).toBe(re);                                                      // idempotent
    delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS;                                                         // retire the old key
    expect(openText(re, opts('thread:t1'))).toBe('secret'); expect(() => openText(old, opts('thread:t1'))).toThrow();
    expect(() => rewrapText(re, opts('thread:other'))).not.toThrow();                                        // same key id: nothing to do (no unwrap)
  });
  it('round-trips bytes with the same guarantees and tells sealed buffers from legacy ones', () => {
    const data = Buffer.from('%PDF-1.4 rc5');
    const s = sealBuffer(data, opts('file:d1:f1', 'dossier-file'));
    expect(isSealedBuffer(s)).toBe(true); expect(openBuffer(s, opts('file:d1:f1', 'dossier-file')).equals(data)).toBe(true);
    expect(() => openBuffer(s, opts('file:d1:f2', 'dossier-file'))).toThrow();
    const bad = Buffer.from(s); bad[bad.length - 1] ^= 1; expect(() => openBuffer(bad, opts('file:d1:f1', 'dossier-file'))).toThrow();
    expect(sealBuffer(data, opts('file:d1:f1', 'dossier-file')).equals(s)).toBe(false);
  });
  it('legacy values written before this change (v1 text, raw legacy buffers) stay readable', () => {
    expect(openText(encrypt('ancien message'), opts('thread:t1'))).toBe('ancien message');
    const legacy = encryptBuffer(Buffer.from('ancien fichier'));
    expect(isSealedBuffer(legacy)).toBe(false); expect(openBuffer(legacy, opts('file:d1:f1', 'dossier-file')).toString()).toBe('ancien fichier');
  });
});
