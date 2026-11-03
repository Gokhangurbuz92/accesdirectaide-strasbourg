/**
 * R39 release — Node's ECDH.getPrivateKey() returns the P-256 private scalar without its leading zero byte about one time in 300; such a
 * 31-byte VAPID key used to be refused (INVALID_KEYS) and made the web-push integration suite fail at random. It is now read as 32 bytes.
 */
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pushConfig, vapidHeader } from '../../api/_services/web-push.js';

const b64u = (b) => Buffer.from(b).toString('base64url');

function shortKeyPair() {
  for (;;) { const e = crypto.createECDH('prime256v1'); e.generateKeys(); if (e.getPrivateKey().length < 32) return e; }
}

describe('VAPID private key without its leading zero byte', () => {
  const e = shortKeyPair();
  const env = { WEB_PUSH_VAPID_PUBLIC_KEY: b64u(e.getPublicKey()), WEB_PUSH_VAPID_PRIVATE_KEY: b64u(e.getPrivateKey()), WEB_PUSH_SUBJECT: 'mailto:contact@example.test' };

  it('is accepted', () => {
    expect(e.getPrivateKey().length).toBeLessThan(32);
    expect(pushConfig(env)).toMatchObject({ ok: true });
  });

  it('signs a VAPID header the push service can verify', () => {
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(vapidHeader('https://fcm.googleapis.com/fcm/send/x', env)) || [];
    const [h, c, s] = m[1].split('.');
    const pub = Buffer.from(m[2], 'base64url');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
    expect(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('a malformed key is still refused', () => {
    expect(pushConfig({ ...env, WEB_PUSH_VAPID_PRIVATE_KEY: b64u(Buffer.alloc(33, 1)) })).toMatchObject({ ok: false, reason: 'INVALID_KEYS' });
  });
});
