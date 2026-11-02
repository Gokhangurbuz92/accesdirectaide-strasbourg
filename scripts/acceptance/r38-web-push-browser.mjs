#!/usr/bin/env node
/**
 * R38 — Web Push end to end in a real browser, LAB only:  npx tsx scripts/acceptance/r38-web-push-browser.mjs [--out result.json]
 * A throwaway VAPID key pair is made in memory for this run (the deployment's installed keys are never read, replaced or printed). A local page on
 * 127.0.0.1 registers the site's real service worker (public/sw.js) in Chrome, the person's permission is granted, the browser subscribes with that key;
 * the subscription goes through the site's own validation (validateSubscription), the message is encrypted (RFC 8291) and signed (VAPID, RFC 8292) by
 * api/_services/web-push.js and POSTed to the push service the browser chose (Google FCM for Chrome). PASS = the push service accepted it (201) AND the
 * service worker showed the notification (registration.getNotifications()) with the generic title, body and in-site link — nothing personal.
 * Also: permission « denied » → no subscription; unsubscribe → the push service answers 404/410 for the ended subscription.
 */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { encryptPayload, vapidHeader, validateSubscription, pushConfig } from '../../api/_services/web-push.js';

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
const env = { WEB_PUSH_VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'), WEB_PUSH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'), WEB_PUSH_SUBJECT: 'mailto:contact@accesdirectaide.fr' };
if (!pushConfig(env).ok) throw new Error('LAB key pair rejected by pushConfig');
const PAGE = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>push LAB</title><body><script>
window.subscribe = async (key) => { const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  const k = Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
  const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k }); return s.toJSON(); };
window.notes = async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, url: n.data && n.data.url, lang: n.lang }));
window.unsub = async () => (await (await (await navigator.serviceWorker.ready).pushManager.getSubscription()).unsubscribe());
</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' }); return res.end(fs.readFileSync('public/sw.js')); }
  if (req.url.startsWith('/icons/')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
}).listen(5182, '127.0.0.1');
const base = 'http://127.0.0.1:5182';
const { chromium } = await import('playwright');
// Playwright's default --disable-background-networking switches off Chrome's connection to its push service (GCM/FCM): a real push needs it on
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: !process.argv.includes('--headed'), ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update'] });
const checks = {};
const send = async (sub, payload) => {
  const v = validateSubscription(sub, env); if (v.error) return { status: v.error };
  const r = await fetch(v.endpoint, { method: 'POST', headers: { TTL: '60', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(v.endpoint, env) },
    body: encryptPayload(payload, v.keys), redirect: 'error', signal: AbortSignal.timeout(15000) });
  return { status: r.status, host: v.host };
};
try {
  // 1. permission granted → subscription → delivered notification
  const ctx = await browser.newContext(); await ctx.grantPermissions(['notifications'], { origin: base });
  const page = await ctx.newPage(); await page.goto(base);
  // a browser without a push service (some headless builds) never answers: bounded, reported, never a pass
  const sub = await Promise.race([page.evaluate((k) => window.subscribe(k), env.WEB_PUSH_VAPID_PUBLIC_KEY).catch((e) => ({ error: String(e?.message || e).slice(0, 200) })),
    new Promise((r) => setTimeout(() => r({ error: 'SUBSCRIBE_TIMEOUT (no push service in this browser)' }), 30000))]);
  if (sub?.error) { checks.subscribeError = sub.error; throw Object.assign(new Error(sub.error), { report: true }); }
  checks.subscribed = Boolean(sub?.endpoint); checks.pushHostAllowed = !validateSubscription(sub, env).error;
  const message = { title: 'AccesDirectAide', body: 'Vous avez une nouvelle information dans votre espace.', url: '/compte' };
  const sent = await send(sub, JSON.stringify(message)); checks.pushServiceAccepted = sent.status === 201; checks.pushHost = sent.host;
  let notes = []; for (let i = 0; i < 30 && !notes.length; i++) { await page.waitForTimeout(1000); notes = await page.evaluate(() => window.notes()); }
  checks.notificationShown = notes.length === 1 && notes[0].title === message.title && notes[0].body === message.body && notes[0].url === '/compte';
  checks.notification = notes[0] || null;
  // 2. unsubscribe → the push service ends it (404 / 410), which makes the site drop the subscription
  await page.evaluate(() => window.unsub()); await page.waitForTimeout(2000);
  const after = await send(sub, JSON.stringify(message)); checks.afterUnsubscribe = after.status; checks.unsubscribeEnds = [404, 410].includes(after.status);
  await ctx.close();
  // 3. permission denied → no subscription at all
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); await p2.goto(base);
  await p2.evaluate(() => Notification.requestPermission().catch(() => 'denied'));
  const denied = await p2.evaluate((k) => window.subscribe(k).then(() => 'SUBSCRIBED', (e) => e.name), env.WEB_PUSH_VAPID_PUBLIC_KEY);
  checks.deniedRefused = denied !== 'SUBSCRIBED'; checks.deniedError = denied; await ctx2.close();
} catch (e) { if (!e.report) throw e; } finally { await browser.close(); server.close(); }
const pass = ['subscribed', 'pushHostAllowed', 'pushServiceAccepted', 'notificationShown', 'unsubscribeEnds', 'deniedRefused'].every((k) => checks[k]);
console.log(`R38_WEB_PUSH ${JSON.stringify({ pass, ...checks })}`);
if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), pass, checks, note: 'LAB throwaway VAPID pair; real Chrome; real push service' }, null, 2));
process.exit(pass ? 0 : 1);
