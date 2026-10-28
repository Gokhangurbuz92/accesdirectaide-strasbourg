// @ts-nocheck
/**
 * R11 / N04 — Web Push for the web application (W3C Push API; RFC 8030 delivery, RFC 8291 message encryption, RFC 8292 VAPID), with NO third-party provider:
 * the message is encrypted for the browser and handed to the push service the browser itself chose (Google, Mozilla, Apple, Microsoft), which can read nothing.
 *  - available only when the deployment holds a VAPID key pair (WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY, base64url) and a contact
 *    (WEB_PUSH_SUBJECT, mailto: or https:) — otherwise the channel is unavailable everywhere (preferences refuse it, nothing is stored, nothing is sent);
 *  - a subscription is accepted only for the push services of the browsers (PUSH_HOSTS: never an arbitrary address the server would then call), sealed at rest;
 *  - a message names nothing personal (the reminders' generic text and a link inside the site); « accepted » means the push service took it — not that the
 *    person saw it (no fake delivery);
 *  - a push service answering 404 / 410 ends the subscription (the browser dropped it); three failures in a row mark it FAILING, a success clears that.
 * Keys for a deployment: `node scripts/web-push-keys.mjs` prints a new pair for the owner to store as secrets (docs/runbooks.md § 7 quinquies).
 */
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { PushSubscription } from '../../src/db/schema.js';
import { openText, sealText } from '../lib/data-keys.js';

/** the push services of the browsers (and their subdomains) */
export const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export const MAX_SUBSCRIPTIONS = 10;
const FAILING_AFTER = 3;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');

/** the deployment's push configuration: { ok, publicKey } or { ok: false, reason } (never the private key) */
export function pushConfig(env = process.env) {
  const pub = unb64u(env.WEB_PUSH_VAPID_PUBLIC_KEY); const priv = unb64u(env.WEB_PUSH_VAPID_PRIVATE_KEY); const subject = String(env.WEB_PUSH_SUBJECT || '');
  if (!env.WEB_PUSH_VAPID_PUBLIC_KEY || !env.WEB_PUSH_VAPID_PRIVATE_KEY || !subject) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return { ok: false, reason: 'INVALID_KEYS' };
  if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject)) return { ok: false, reason: 'INVALID_SUBJECT' };
  return { ok: true, publicKey: b64u(pub) };
}

/** hosts a test may add (never in production): the local push-service simulator of the integration suite */
const extraHosts = (env) => (env.VERCEL_ENV === 'production' ? [] : String(env.WEB_PUSH_TEST_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
const hostAllowed = (host, env) => [...PUSH_HOSTS, ...extraHosts(env)].some((d) => host === d || host.endsWith(`.${d}`));

/** a browser's PushSubscription (toJSON()) as the server accepts it: { endpoint, keys: { p256dh, auth } } | { error } */
export function validateSubscription(sub, env = process.env) {
  const s = sub && typeof sub === 'object' ? sub : {};
  let u; try { u = new URL(String(s.endpoint || '')); } catch { return { error: 'INVALID_ENDPOINT' }; }
  const local = extraHosts(env).includes(u.hostname.toLowerCase());
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { error: 'INVALID_ENDPOINT' };
  if (!hostAllowed(u.hostname.toLowerCase(), env) || u.username || u.password || String(s.endpoint).length > 1000) return { error: 'PUSH_SERVICE_NOT_ALLOWED' };
  const p256dh = unb64u(s.keys?.p256dh); const auth = unb64u(s.keys?.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return { error: 'INVALID_KEYS' };
  return { endpoint: u.toString(), keys: { p256dh: b64u(p256dh), auth: b64u(auth) }, host: u.hostname.toLowerCase() };
}

// ------------------------------------------------------------------------------------------------ RFC 8291 (aes128gcm) and RFC 8292 (VAPID)
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
/**
 * The encrypted body of one push message (RFC 8291 § 3.4, one record): salt || rs || idlen || as_public || ciphertext. `asKeys` / `salt` only for the RFC's
 * test vector; otherwise a new ephemeral key and salt per message.
 */
export function encryptPayload(plaintext, { p256dh, auth }, { asKeys = null, salt = null } = {}) {
  const uaPublic = unb64u(p256dh); const authSecret = unb64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (asKeys) ecdh.setPrivateKey(unb64u(asKeys.privateKey)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const s = salt ? unb64u(salt) : crypto.randomBytes(16);
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(s, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([s, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** the reverse (the browser's side) — used by the tests and the local push-service simulator only */
export function decryptPayload(message, { privateKey, p256dh, auth }) {
  const salt = message.subarray(0, 16); const idlen = message[20]; const asPublic = message.subarray(21, 21 + idlen); const ct = message.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(unb64u(privateKey));
  const uaPublic = unb64u(p256dh);
  const prkKey = hmac(unb64u(auth), ecdh.computeSecret(asPublic));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = padded.length - 1; while (end >= 0 && padded[end] === 0) end -= 1;
  return padded.subarray(0, end).toString('utf8');
}

/** the VAPID Authorization header for an endpoint (RFC 8292: ES256 JWT, audience = the push service's origin, at most 24 h) */
export function vapidHeader(endpoint, env = process.env, now = Date.now()) {
  const pub = unb64u(env.WEB_PUSH_VAPID_PUBLIC_KEY);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: env.WEB_PUSH_VAPID_PRIVATE_KEY, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.WEB_PUSH_SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${b64u(pub)}`;
}

// ------------------------------------------------------------------------------------------------ subscriptions
const hashEndpoint = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex');
const seal = (userId, id, v) => sealText(JSON.stringify(v), { purpose: 'push-subscription', context: `push:${userId}:${id}` });
const open = (userId, id, s) => JSON.parse(String(openText(s, { purpose: 'push-subscription', context: `push:${userId}:${id}` }) || '{}'));

/** stores (or moves to this account) a browser's subscription; at most MAX_SUBSCRIPTIONS per account (the oldest go) */
export async function saveSubscription(userId, sub, { db = defaultDb, env = process.env } = {}) {
  const v = validateSubscription(sub, env); if (v.error) return { ok: false, status: 400, code: v.error, message: 'Abonnement de notification non reconnu.' };
  const endpointHash = hashEndpoint(v.endpoint);
  return db.transaction(async (tx) => {
    await tx.delete(PushSubscription).where(eq(PushSubscription.endpointHash, endpointHash));   // the same browser, perhaps another account before: it now belongs to this one
    const id = crypto.randomUUID();
    await tx.insert(PushSubscription).values({ id, userId, endpointHash, subscriptionEncrypted: seal(userId, id, { endpoint: v.endpoint, keys: v.keys }), pushHost: v.host });
    await tx.execute(sql`DELETE FROM "PushSubscription" WHERE "userId" = ${userId} AND id NOT IN (SELECT id FROM "PushSubscription" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT ${MAX_SUBSCRIPTIONS})`);
    return { ok: true, status: 201, id };
  });
}
/** removes this browser's subscription (endpoint given) or all of the account's */
export async function removeSubscriptions(userId, endpoint = null, { db = defaultDb } = {}) {
  const where = endpoint ? and(eq(PushSubscription.userId, userId), eq(PushSubscription.endpointHash, hashEndpoint(String(endpoint)))) : eq(PushSubscription.userId, userId);
  const gone = await db.delete(PushSubscription).where(where).returning({ id: PushSubscription.id });
  return { ok: true, status: 200, removed: gone.length };
}
export async function subscriptionCount(userId, { db = defaultDb } = {}) {
  return Number((await db.execute(sql`SELECT count(*)::int AS n FROM "PushSubscription" WHERE "userId" = ${userId}`)).rows[0]?.n || 0);
}

/**
 * Sends one message to every subscription of an account: { status: NOT_CONFIGURED | NO_SUBSCRIPTION | ACCEPTED | FAILED, accepted, failed, expired }.
 * @param {{ title: string, body: string, url: string }} message only generic, non-personal words and a link inside the site
 */
export async function sendToUser(userId, message, { db = defaultDb, env = process.env, fetchImpl = fetch, ttl = 86400 } = {}) {
  if (!pushConfig(env).ok) return { status: 'NOT_CONFIGURED', accepted: 0, failed: 0, expired: 0 };
  const rows = await db.select().from(PushSubscription).where(eq(PushSubscription.userId, userId));
  if (!rows.length) return { status: 'NO_SUBSCRIPTION', accepted: 0, failed: 0, expired: 0 };
  const url = String(message.url || '/').startsWith('/') && !String(message.url).startsWith('//') ? String(message.url) : '/';
  const payload = JSON.stringify({ title: String(message.title).slice(0, 80), body: String(message.body).slice(0, 240), url });
  let accepted = 0; let failed = 0; let expired = 0;
  for (const row of rows) {
    let sub; try { sub = open(userId, row.id, row.subscriptionEncrypted); } catch { failed += 1; continue; }
    const v = validateSubscription(sub, env); if (v.error) { await db.delete(PushSubscription).where(eq(PushSubscription.id, row.id)); expired += 1; continue; }
    let status = 0;
    try {
      const r = await fetchImpl(v.endpoint, { method: 'POST', headers: { TTL: String(ttl), Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(v.endpoint, env) },
        body: encryptPayload(payload, v.keys), redirect: 'error', signal: AbortSignal.timeout(10000) });
      status = r.status;
    } catch { status = 0; }
    if (status === 201 || status === 202 || status === 200) {
      accepted += 1; await db.update(PushSubscription).set({ status: 'ACTIVE', failureCount: 0, lastSuccessAt: new Date() }).where(eq(PushSubscription.id, row.id));
    } else if (status === 404 || status === 410) {
      expired += 1; await db.delete(PushSubscription).where(eq(PushSubscription.id, row.id));   // the browser ended it
    } else {
      failed += 1; const n = (row.failureCount || 0) + 1;
      await db.update(PushSubscription).set({ failureCount: n, status: n >= FAILING_AFTER ? 'FAILING' : row.status, lastFailureAt: new Date() }).where(eq(PushSubscription.id, row.id));
    }
  }
  return { status: accepted ? 'ACCEPTED' : 'FAILED', accepted, failed, expired };
}
