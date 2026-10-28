/**
 * R11 / N04 — Web Push on REAL PostgreSQL, with a LOCAL push-service simulator in place of the browsers' push services (no network, no provider): with the
 * deployment's VAPID keys set, a person who consented subscribes a browser; the subscription is sealed at rest and only a browser push service is accepted
 * (no arbitrary address the server would call); a Parcours reminder is encrypted for that browser (RFC 8291 — the simulator decrypts it with the browser's key)
 * and signed (RFC 8292 VAPID — the simulator checks the signature, audience and expiry); the message names nothing personal; 410 ends the subscription;
 * repeated failures mark it FAILING; « accepted » is all that is recorded; unsubscribing and deleting the account remove it. Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const U = `wp-${Date.now().toString(36)}`;
const b64u = (b) => Buffer.from(b).toString('base64url');

describe.skipIf(!hasDatabase)('web push (real DB, local push-service simulator)', () => {
  let db; let wp; let svc; let parcours; const saved = {}; const vapid = crypto.createECDH('prime256v1'); const browser = crypto.createECDH('prime256v1'); const authSecret = crypto.randomBytes(16);
  const received = []; let answer = 201;
  const endpoint = `https://fcm.googleapis.com/fcm/send/${U}-device`;
  const subscription = () => ({ endpoint, keys: { p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret) } });
  /** the push service: checks VAPID (RFC 8292) and decrypts (RFC 8291) as the browser would */
  const simulator = async (url, init) => {
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(init.headers.Authorization);
    const [h, c, s] = m[1].split('.'); const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    const pub = Buffer.from(m[2], 'base64url');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
    const valid = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    const plain = wp.decryptPayload(Buffer.from(init.body), { privateKey: b64u(browser.getPrivateKey()), p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret) });
    received.push({ url: String(url), valid, claims, encoding: init.headers['Content-Encoding'], ttl: init.headers.TTL, payload: JSON.parse(plain), k: m[2] });
    return new Response('', { status: answer });
  };

  beforeAll(async () => {
    vapid.generateKeys(); browser.generateKeys();
    for (const k of ['WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_SUBJECT']) saved[k] = process.env[k];
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey()); process.env.WEB_PUSH_VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey()); process.env.WEB_PUSH_SUBJECT = 'mailto:contact@example.test';
    ({ db } = await import('../../src/db/index.js'));
    wp = await import('../../api/_services/web-push.js');
    svc = await import('../../api/_services/citizen-account.js');
    parcours = await import('../../api/_handlers/cron/parcours-reminder.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${U}, ${`${U}@example.test`}, 'x', NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (db) { await db.execute(sql`DELETE FROM "ParcoursItem" WHERE "userId" = ${U}`).catch(() => {}); await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U}`).catch(() => {}); }
  });

  it('needs the keys: without them the channel is unavailable; with them, the consent comes first', async () => {
    expect(wp.pushConfig({})).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    expect(wp.pushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: 'abc', WEB_PUSH_VAPID_PRIVATE_KEY: 'def', WEB_PUSH_SUBJECT: 'mailto:a@b.c' }).ok).toBe(false);
    expect(wp.pushConfig().ok).toBe(true);
    expect(await svc.setPreference(U, { channel: 'push', category: 'reminder', enabled: true })).toMatchObject({ ok: false, code: 'CONSENT_REQUIRED' });
    expect(await svc.setPreference(U, { channel: 'push', category: 'reminder', enabled: true, consentGiven: true })).toMatchObject({ ok: true });
    expect((await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_id = ${U} AND purpose = 'NOTIF_PUSH_REMINDER'`)).rows.map((r) => r.decision)).toEqual([true]);
  });

  it('accepts only a browser push service, with valid keys; stores the subscription sealed, one row per browser', async () => {
    for (const bad of ['https://127.0.0.1/push', 'http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'not a url'])
      expect((await wp.saveSubscription(U, { ...subscription(), endpoint: bad })).ok, bad).toBe(false);
    expect((await wp.saveSubscription(U, { ...subscription(), keys: { p256dh: 'AAAA', auth: 'BBBB' } })).code).toBe('INVALID_KEYS');
    expect(await wp.saveSubscription(U, subscription())).toMatchObject({ ok: true, status: 201 });
    expect(await wp.saveSubscription(U, subscription())).toMatchObject({ ok: true });   // the same browser again: still one row
    const rows = (await db.execute(sql`SELECT "subscriptionEncrypted" AS s, "pushHost" AS h FROM "PushSubscription" WHERE "userId" = ${U}`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].h).toBe('fcm.googleapis.com');
    expect(rows[0].s).not.toContain(U); expect(rows[0].s).not.toContain('fcm.googleapis');
  });

  it('a Parcours reminder reaches the push service encrypted for that browser and signed; nothing personal in it; « accepted » is recorded', async () => {
    vi.stubGlobal('fetch', simulator);
    const tomorrow = new Date(Date.now() + 18 * 3600000);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "dueDate", "dueSourceUrl", "updatedAt") VALUES (${`${U}-item`}, ${U}, 'MANUAL', 'custom', 'Dossier APL de Jeanne Martin', ${tomorrow}, 'https://www.service-public.fr/particuliers/vosdroits/F1', NOW())`);
    await parcours.runParcoursReminders();
    const mine = received.filter((r) => r.url === endpoint);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ valid: true, encoding: 'aes128gcm', ttl: '86400', k: process.env.WEB_PUSH_VAPID_PUBLIC_KEY, claims: { aud: 'https://fcm.googleapis.com', sub: 'mailto:contact@example.test' } });
    expect(mine[0].claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(24 * 3600000);
    expect(mine[0].payload).toMatchObject({ title: 'Rappel AccesDirectAide', url: '/compte/parcours' });
    expect(JSON.stringify(mine[0].payload)).not.toMatch(/Jeanne|Martin|APL|@/);
    const status = (await db.execute(sql`SELECT status FROM "ParcoursReminder" WHERE "itemId" = ${`${U}-item`} AND channel = 'push'`)).rows[0]?.status;
    expect(status).toBe('PROVIDER_ACCEPTED');
    expect((await db.execute(sql`SELECT "lastSuccessAt" IS NOT NULL AS ok FROM "PushSubscription" WHERE "userId" = ${U}`)).rows[0].ok).toBe(true);
  });

  it('failures are counted (FAILING after three); 410 from the push service ends the subscription', async () => {
    answer = 503;
    for (let i = 0; i < 3; i += 1) expect((await wp.sendToUser(U, { title: 't', body: 'b', url: '/compte' }, { fetchImpl: simulator })).status).toBe('FAILED');
    expect((await db.execute(sql`SELECT status, "failureCount" AS n FROM "PushSubscription" WHERE "userId" = ${U}`)).rows[0]).toMatchObject({ status: 'FAILING', n: 3 });
    answer = 201;
    expect((await wp.sendToUser(U, { title: 't', body: 'b', url: 'https://evil.example/' }, { fetchImpl: simulator })).status).toBe('ACCEPTED');
    expect(received.at(-1).payload.url, 'a link outside the site is never sent').toBe('/');
    expect((await db.execute(sql`SELECT status, "failureCount" AS n FROM "PushSubscription" WHERE "userId" = ${U}`)).rows[0]).toMatchObject({ status: 'ACTIVE', n: 0 });
    answer = 410;
    expect(await wp.sendToUser(U, { title: 't', body: 'b', url: '/compte' }, { fetchImpl: simulator })).toMatchObject({ expired: 1 });
    expect(await wp.subscriptionCount(U)).toBe(0);
    expect((await wp.sendToUser(U, { title: 't', body: 'b', url: '/' }, { fetchImpl: simulator })).status).toBe('NO_SUBSCRIPTION');
  });

  it('unsubscribing removes it; deleting the account removes it too', async () => {
    answer = 201;
    await wp.saveSubscription(U, subscription());
    expect(await wp.removeSubscriptions(U, endpoint)).toMatchObject({ removed: 1 });
    // R12 (N04): withdrawing the last push consent deletes the stored subscriptions too
    await wp.saveSubscription(U, subscription());
    const off = await svc.setPreference(U, { channel: 'push', category: 'reminder', enabled: false });
    expect(off).toMatchObject({ ok: true, pushSubscriptionsRemoved: 1 });
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM "PushSubscription" WHERE "userId" = ${U}`)).rows[0].n)).toBe(0);
    await wp.saveSubscription(U, subscription());
    await db.execute(sql`DELETE FROM "ParcoursItem" WHERE "userId" = ${U}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U}`);
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM "PushSubscription" WHERE "userId" = ${U}`)).rows[0].n)).toBe(0);
  });
});
