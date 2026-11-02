/**
 * R39 (G) — Web Push over REAL HTTP on the LAB: a local push-service simulator listens on 127.0.0.1 (allowed only through WEB_PUSH_TEST_HOSTS, never in
 * production), the citizen's subscription is saved through the service, and sendToUser uses the DEFAULT fetch (no injected function): the request crosses
 * the network stack with its real headers (TTL, Urgency, aes128gcm, VAPID) and body; the simulator verifies the VAPID signature (RFC 8292) and decrypts the
 * message with the browser's key (RFC 8291). 410 from the push service ends the subscription. This is a SIMULATOR: it proves the server side end to end,
 * not a delivery by Google/Mozilla/Apple (R38: Chrome under automation registers no push service). Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const U = `wph-${Date.now().toString(36)}`;
const b64u = (b) => Buffer.from(b).toString('base64url');

describe.skipIf(!hasDatabase)('web push over real HTTP to a local push-service simulator', () => {
  let db; let wp; let server; let port; const saved = {}; const received = []; let answer = 201;
  const vapid = crypto.createECDH('prime256v1'); const browser = crypto.createECDH('prime256v1'); const authSecret = crypto.randomBytes(16);
  beforeAll(async () => {
    vapid.generateKeys(); browser.generateKeys();
    server = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      try {
        const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(req.headers.authorization || ''));
        const [h, c, s] = m[1].split('.'); const pub = Buffer.from(m[2], 'base64url');
        const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
        const valid = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
        const plain = wp.decryptPayload(Buffer.concat(chunks), { privateKey: b64u(browser.getPrivateKey()), p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret) });
        received.push({ path: req.url, method: req.method, valid, claims: JSON.parse(Buffer.from(c, 'base64url').toString()), encoding: req.headers['content-encoding'], ttl: req.headers.ttl, urgency: req.headers.urgency, payload: JSON.parse(plain) });
      } catch (e) { received.push({ error: e.message }); }
      res.writeHead(answer).end(); }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
    for (const k of ['WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_SUBJECT', 'WEB_PUSH_TEST_HOSTS']) saved[k] = process.env[k];
    Object.assign(process.env, { WEB_PUSH_VAPID_PUBLIC_KEY: b64u(vapid.getPublicKey()), WEB_PUSH_VAPID_PRIVATE_KEY: b64u(vapid.getPrivateKey()), WEB_PUSH_SUBJECT: 'mailto:contact@example.test', WEB_PUSH_TEST_HOSTS: '127.0.0.1' });
    ({ db } = await import('../../src/db/index.js')); wp = await import('../../api/_services/web-push.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${U}, ${`${U}@example.test`}, 'x', NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (db) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U}`).catch(() => {});
    await new Promise((r) => server.close(r));
  });
  const sub = () => ({ endpoint: `http://127.0.0.1:${port}/push/${U}`, keys: { p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret) } });

  it('the local endpoint is refused without WEB_PUSH_TEST_HOSTS and always in production', () => {
    expect(wp.validateSubscription(sub(), { ...process.env, WEB_PUSH_TEST_HOSTS: '' }).error).toBe('INVALID_ENDPOINT');   // plain http to an unlisted host
    expect(wp.validateSubscription(sub(), { ...process.env, VERCEL_ENV: 'production' }).error).toBeTruthy();
    expect(wp.validateSubscription(sub()).error).toBeUndefined();
  });
  it('a reminder crosses real HTTP: signed, encrypted, decrypted by the browser key; nothing personal in it', async () => {
    expect((await wp.saveSubscription(U, sub())).ok).toBe(true);
    const out = await wp.sendToUser(U, { title: 'Rappel AccesDirectAide', body: 'Une étape de votre parcours arrive à échéance.', url: '/compte/parcours' });
    expect(out).toMatchObject({ status: 'ACCEPTED', accepted: 1, failed: 0 });
    const r = received.at(-1);
    expect(r).toMatchObject({ method: 'POST', path: `/push/${U}`, valid: true, encoding: 'aes128gcm', ttl: '86400', urgency: 'normal', claims: { aud: `http://127.0.0.1:${port}`, sub: 'mailto:contact@example.test' } });
    expect(r.payload).toEqual({ title: 'Rappel AccesDirectAide', body: 'Une étape de votre parcours arrive à échéance.', url: '/compte/parcours' });
    expect(JSON.stringify(r.payload)).not.toContain(`${U}@example.test`);
  });
  it('410 from the push service ends the subscription (the browser dropped it)', async () => {
    answer = 410;
    expect(await wp.sendToUser(U, { title: 't', body: 'b', url: '/' })).toMatchObject({ expired: 1 });
    expect(await wp.subscriptionCount(U)).toBe(0);
    answer = 201;
  });
});
