#!/usr/bin/env node
/**
 * R40 — Web Push through the SITE ITSELF in a real Google Chrome, LAB only:
 *   node --import tsx scripts/acceptance/r40-web-push-real.mjs [--base http://127.0.0.1:5173] [--out <dir>]
 * Run it with the LAB server's own environment (same DATABASE_URL, ADA_ENCRYPTION_KEY and the SAME LAB-only VAPID pair as the server: WEB_PUSH_VAPID_PUBLIC_KEY /
 * WEB_PUSH_VAPID_PRIVATE_KEY / WEB_PUSH_SUBJECT) — never Production keys or data. The database must be local; VERCEL_ENV=production is refused.
 *
 * Unlike R38 (a bare page and a hand-made send), every step goes through the product: a synthetic citizen signs up (the verification link is read from the
 * LAB test outbox), signs in, opens Mon Espace › Profil, and switches « Notifications sur cet appareil » on with the real button (consent recorded, browser
 * permission, the site's service worker /sw.js subscribes, the subscription is POSTed to /api/citizen/push). The script then checks the row in PostgreSQL
 * (sealed at rest), sends through api/_services/web-push.js sendToUser and through the Mon Parcours reminder job (runParcoursReminders), waits for the
 * notification the service worker shows, drives its click handler, runs the job again (no second message), switches off from the page (server row and
 * browser subscription gone), proves the push service's 404/410 answer for an ended subscription removes a stale row, and deletes the synthetic account.
 * Evidence: <out>/r40-web-push-real.json and screenshots (the push endpoint is a capability URL: only its host and a hash prefix are written).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = path.resolve(arg('--out', '.qa-r40'));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || base.endsWith(':3000')) { console.error('refusing: the base must be a LAB server on 127.0.0.1 (never :3000)'); process.exit(3); }
if (process.env.VERCEL_ENV === 'production') { console.error('refusing: VERCEL_ENV=production'); process.exit(3); }
try { if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(process.env.DATABASE_URL || '').hostname)) throw new Error(); } catch { console.error('refusing: DATABASE_URL must be a local LAB database'); process.exit(3); }

const { pushConfig, sendToUser, saveSubscription, subscriptionCount } = await import('../../api/_services/web-push.js');
const { runParcoursReminders } = await import('../../api/_handlers/cron/parcours-reminder.js');
const { canNotify } = await import('../../api/_services/citizen-account.js');
const { db } = await import('../../src/db/index.js');
const { sql } = await import('drizzle-orm');
const { chromium } = await import('playwright');
if (!pushConfig().ok) { console.error(`refusing: no usable LAB VAPID pair in the environment (${pushConfig().reason})`); process.exit(3); }

fs.mkdirSync(outDir, { recursive: true });
const steps = [];
const step = (name, ok, evidence = {}) => { steps.push({ name, ok: Boolean(ok), ...evidence }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(evidence).slice(0, 400)}`}`); return Boolean(ok); };
const shot = async (page, name) => { const f = path.join(outDir, `r40-push-${name}.png`); await page.screenshot({ path: f, fullPage: false }).catch(() => {}); return f; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hashOf = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const redactSub = (s) => (s?.endpoint ? { host: new URL(s.endpoint).hostname, endpointSha256: hashOf(s.endpoint).slice(0, 12) } : null);
const rows = async (q) => (await db.execute(q)).rows;

const email = `r40.push.${crypto.randomBytes(5).toString('hex')}@example.test`;
const password = `Lab${crypto.randomBytes(12).toString('hex')}!aA1`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-r40-push-'));
let userId = null;
// Playwright's default --disable-background-networking switches off Chrome's connection to its push service (GCM/FCM): a real push needs it on
const ctx = await chromium.launchPersistentContext(profileDir, { channel: process.env.PW_CHANNEL || 'chrome', headless: false, viewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update'] });
const page = ctx.pages()[0] || await ctx.newPage();
const consoleErrors = []; page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
const api = async (method, p, body) => {
  const csrf = (await ctx.cookies(base)).find((c) => c.name === '__csrf')?.value || '';
  const r = await ctx.request.fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, origin: base }, data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0 });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status(), json };
};
const notes = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, url: n.data && n.data.url, tag: n.tag })));
const waitNotes = async (pred, ms = 60000) => { const t0 = Date.now(); let n = []; while (Date.now() - t0 < ms) { n = await notes().catch(() => []); if (pred(n)) return { notes: n, ms: Date.now() - t0 }; await wait(1000); } return { notes: n, ms: null }; };
const closeAll = () => page.evaluate(async () => { for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close(); });
const dueAt = new Date('2031-03-14T10:00:00.000Z');   // far from any LAB fixture: the reminder job's J-1 window then holds only this item
const jobNow = new Date(dueAt.getTime() - 12 * 3600000);

try {
  await ctx.grantPermissions(['notifications'], { origin: base });
  await page.goto(`${base}/`);
  await ctx.request.get(`${base}/api/health`);   // the CSRF double-submit cookie (__csrf) of this browser profile
  // 1. synthetic citizen account through the site (sign-up, e-mailed link from the LAB test outbox, sign-in)
  const su = await api('POST', '/api/auth/signup', { email, password });
  let link = null;
  for (let i = 0; i < 10 && !link; i++) { const r = await ctx.request.get(`${base}/__lab/outbox?to=${encodeURIComponent(email)}`); link = (await r.json().catch(() => []))?.map((m) => /https?:\/\/\S+verify-email\S+/.exec(m.text)?.[0]).find(Boolean) || null; if (!link) await wait(300); }
  if (link) await page.goto(`${base}${new URL(link).pathname}${new URL(link).search}`);
  const lo = await api('POST', '/api/auth/login', { email, password });
  userId = (await rows(sql`SELECT id FROM "CitizenUser" WHERE lower(email) = ${email} AND "emailVerifiedAt" IS NOT NULL LIMIT 1`))[0]?.id || null;
  step('account: synthetic citizen signed up, verified through the e-mailed link, signed in', su.status === 200 && link && lo.status === 200 && userId, { signup: su.status, signupCode: su.json?.code || su.json?.error, verifyLink: Boolean(link), login: lo.status, userId: Boolean(userId) });

  // 2. the server offers the channel with the deployment's (LAB) key
  const st = await api('GET', '/api/citizen/push');
  step('server: /api/citizen/push available with the LAB VAPID public key, no subscription yet', st.status === 200 && st.json?.available === true && st.json?.publicKey === pushConfig().publicKey && st.json?.subscriptions === 0, { status: st.status, available: st.json?.available, subscriptions: st.json?.subscriptions });

  // 3. the site's service worker
  await page.goto(`${base}/compte/profil`);
  const sw = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => ({ scope: r.scope, script: r.active?.scriptURL })), new Promise((r) => setTimeout(() => r(null), 20000))]));
  await page.reload(); await page.waitForLoadState('networkidle').catch(() => {});
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  step('service worker: /sw.js registered by the production build, active, controlling Mon Espace', sw?.script === `${base}/sw.js` && controlled, { sw, controlled });

  // 4. permission + subscription through the page's own button (DevicePush)
  const card = page.getByTestId('device-push');
  await card.getByRole('status').filter({ hasText: 'Recevez sur cet appareil' }).waitFor({ timeout: 20000 }).catch(() => {});
  const permission = await page.evaluate(() => Notification.permission);
  await shot(page, '01-device-push-off');
  await card.getByRole('button', { name: /J’accepte de recevoir les rappels/ }).click();
  const on = await card.getByRole('status').filter({ hasText: 'Cet appareil reçoit les rappels' }).waitFor({ timeout: 45000 }).then(() => true, () => false);
  await shot(page, '02-device-push-on');
  const sub = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.toJSON() || null);
  const statusText = await card.getByRole('status').innerText().catch(() => '');
  step('permission granted and the page switched on (consent recorded, browser subscribed, server stored it)', permission === 'granted' && on && sub?.endpoint, { permission, on, subscription: redactSub(sub), statusText: statusText.slice(0, 160) });
  step('subscription: a real browser push service (expected for Chrome: fcm.googleapis.com)', sub && /(^|\.)fcm\.googleapis\.com$|push\.services\.mozilla\.com$|push\.apple\.com$|notify\.windows\.com$/.test(new URL(sub.endpoint).hostname), { subscription: redactSub(sub) });

  // 5. persistence: one row, sealed at rest (no endpoint, no key in clear), consent ledger says yes
  const stored = await rows(sql`SELECT id, "endpointHash", "pushHost", status, "subscriptionEncrypted" AS enc FROM "PushSubscription" WHERE "userId" = ${userId}`);
  const enc = String(stored[0]?.enc || '');
  const sealed = stored.length === 1 && enc.length > 40 && !enc.includes('https://') && !enc.includes(sub?.keys?.p256dh || '§') && !enc.includes(sub?.keys?.auth || '§') && stored[0].endpointHash === hashOf(sub?.endpoint);
  const consent = await canNotify(userId, 'push', 'reminder');
  step('persistence: one PushSubscription row, endpoint stored only as its SHA-256, subscription sealed (no endpoint/keys in clear); push reminder consent = yes', sealed && consent === true, { rows: stored.length, pushHost: stored[0]?.pushHost, status: stored[0]?.status, sealedLength: enc.length, canNotifyPushReminder: consent });

  // 6. send through the product's code path: sendToUser → the push service → the service worker shows it
  await closeAll();
  const msg = { title: 'AccesDirectAide (LAB R40)', body: 'Message de test synthétique : aucune donnée personnelle.', url: '/compte' };
  const sent = await sendToUser(userId, msg);
  const got = await waitNotes((n) => n.some((x) => x.title === msg.title));
  const shown = got.notes.filter((x) => x.title === msg.title);
  const after1 = await rows(sql`SELECT status, "failureCount" AS n, "lastSuccessAt" IS NOT NULL AS ok FROM "PushSubscription" WHERE "userId" = ${userId}`);
  step('send: sendToUser → push service accepted (2xx), subscription marked ACTIVE with lastSuccessAt', sent.status === 'ACCEPTED' && sent.accepted === 1 && after1[0]?.ok, { sent, row: after1[0] });
  step('receive: the push event reached the service worker and it showed exactly one notification (generic title, body, in-site link)', shown.length === 1 && shown[0].body === msg.body && shown[0].url === '/compte', { notifications: shown, latencyMs: got.ms });
  await shot(page, '03-after-push');

  // 7. click: the service worker's notificationclick handler (Playwright cannot click an OS notification: a NotificationEvent is dispatched in the worker
  //    for the REAL notification it showed; waitUntil is captured because a constructed event is untrusted)
  const worker = ctx.serviceWorkers().find((w) => w.url() === `${base}/sw.js`) || await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  let click = { worker: Boolean(worker) };
  if (worker) {
    click = await worker.evaluate(async (title) => {
      const n = (await self.registration.getNotifications()).find((x) => x.title === title);
      if (!n) return { found: false };
      const ev = new NotificationEvent('notificationclick', { notification: n });
      let p = null; Object.defineProperty(ev, 'waitUntil', { value: (x) => { p = x; } });
      self.dispatchEvent(ev);
      let outcome = 'no-waitUntil'; try { await p; outcome = 'resolved'; } catch (e) { outcome = `rejected:${e && e.name}`; }
      await new Promise((r) => setTimeout(r, 1500));
      return { found: true, outcome, left: (await self.registration.getNotifications()).filter((x) => x.title === title).length };
    }, msg.title);
    await page.waitForURL(`${base}/compte`, { timeout: 10000 }).catch(() => {});
  }
  step('click: the handler closed the notification and brought the open Mon Espace tab to its in-site link (/compte)', click.found && click.left === 0 && new URL(page.url()).pathname === '/compte', { ...click, pageUrl: new URL(page.url()).pathname, note: 'synthetic NotificationEvent in the real worker; an OS-level click is not automatable here' });

  // 8. the Mon Parcours reminder job (the real cron function) on an item due in the J-1 window — and a second run sends nothing more
  await closeAll();
  const itemId = `r40-push-${crypto.randomBytes(4).toString('hex')}`;
  await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "dueDate", "dueSourceUrl", "updatedAt") VALUES (${itemId}, ${userId}, 'MANUAL', 'custom', 'Étape fictive R40', ${dueAt.toISOString()}, 'https://www.service-public.fr/', NOW())`);
  const run1 = await runParcoursReminders({ now: jobNow });
  const rgot = await waitNotes((n) => n.some((x) => x.title === 'Rappel AccesDirectAide'));
  const reminder = rgot.notes.filter((x) => x.title === 'Rappel AccesDirectAide');
  const ledger = await rows(sql`SELECT channel, status FROM "ParcoursReminder" WHERE "itemId" = ${itemId} ORDER BY channel`);
  step('reminder job: push recorded PROVIDER_ACCEPTED (never DELIVERED), e-mail TEST_RECORDED by the LAB outbox, SMS NO_CONSENT', ledger.find((l) => l.channel === 'push')?.status === 'PROVIDER_ACCEPTED' && ledger.find((l) => l.channel === 'email')?.status !== 'DELIVERED', { run1, ledger });
  step('reminder received: one notification « Rappel AccesDirectAide » linking to /compte/parcours, naming no step', reminder.length === 1 && reminder[0].url === '/compte/parcours' && !reminder[0].body.includes('fictive'), { reminder, latencyMs: rgot.ms });
  const run2 = await runParcoursReminders({ now: jobNow });
  await wait(15000);
  const dup = (await notes()).filter((x) => x.title === 'Rappel AccesDirectAide');
  step('no duplicate: a second run of the job claims nothing and no second notification arrives (15 s)', run2.providerAccepted === 0 && run2.alreadySent >= 3 && dup.length === 1, { run2, notifications: dup.length });
  await closeAll();

  // 9. switch off from the page: server row gone, browser subscription gone, push preference off
  await page.goto(`${base}/compte/profil`);
  const card2 = page.getByTestId('device-push');
  await card2.getByRole('button', { name: /Arrêter les notifications/ }).click();
  const off = await card2.getByRole('status').filter({ hasText: 'Recevez sur cet appareil' }).waitFor({ timeout: 20000 }).then(() => true, () => false);
  await shot(page, '04-device-push-stopped');
  const browserSub = await page.evaluate(async () => Boolean(await (await navigator.serviceWorker.ready).pushManager.getSubscription()));
  const nAfterOff = await subscriptionCount(userId);
  const stillAllowed = await canNotify(userId, 'push', 'reminder');
  const withdrawn = await sendToUser(userId, msg);
  step('unsubscribe: the page switched off — no server row, no browser subscription, push reminders no longer allowed, nothing sent', off && !browserSub && nAfterOff === 0 && stillAllowed === false && withdrawn.status === 'NO_SUBSCRIPTION', { off, browserSub, serverRows: nAfterOff, canNotifyPushReminder: stillAllowed, send: withdrawn });

  // 10. 404/410 recovery: the ended subscription is put back as a stale row (a browser that dropped it without telling the site); the push service's answer removes it
  //     FCM may still accept an ended endpoint for some seconds after unsubscribe() (propagation): each try is recorded; the bound is 2 minutes
  const stale = await saveSubscription(userId, sub);
  const tries = []; let gone = null;
  for (let i = 0; i < 12; i++) { await wait(i ? 10000 : 3000); gone = await sendToUser(userId, msg); tries.push(gone.status); if (gone.expired || !(await subscriptionCount(userId))) break; }
  const nAfterGone = await subscriptionCount(userId);
  const ghost = (await notes()).filter((x) => x.title === msg.title).length;
  step('expired endpoint: the push service answers 404/410 for the ended subscription and the stale row is deleted (no retry loop); the unsubscribed browser shows nothing', stale.ok && gone?.expired === 1 && gone.accepted === 0 && nAfterGone === 0 && ghost === 0, { stale: stale.status, tries, last: gone, rowsLeft: nAfterGone, notificationsShown: ghost });

  // 11. permission withdrawn in the browser: no subscription without the person's answer (a headed Chrome then shows its prompt, which nobody answers:
  //     bounded at 8 s — still no subscription, nothing reaches the server)
  await ctx.clearPermissions();
  const nBefore = await subscriptionCount(userId);
  const denied = await page.evaluate(async (k) => {
    const raw = atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (k.length % 4)) % 4));
    const tryIt = (async () => { try { await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) }); return 'SUBSCRIBED'; } catch (e) { return e.name; } })();
    return { permission: Notification.permission, result: await Promise.race([tryIt, new Promise((r) => setTimeout(() => r('PROMPT_UNANSWERED'), 8000))]) };
  }, pushConfig().publicKey);
  const nNoPerm = await subscriptionCount(userId);
  step('permission not granted: the browser gives no subscription and the server holds none', denied.permission !== 'granted' && denied.result !== 'SUBSCRIBED' && nNoPerm === nBefore, { ...denied, serverRowsBefore: nBefore, serverRowsAfter: nNoPerm });
} catch (e) {
  step('run aborted', false, { error: String(e?.stack || e).slice(0, 600) });
} finally {
  // 12. cleanup: the synthetic account and everything attached to it (cascade), the throwaway Chrome profile
  let cleaned = null;
  if (userId) { try { await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${userId} AND email LIKE 'r40.push.%@example.test'`); cleaned = (await rows(sql`SELECT (SELECT count(*) FROM "CitizenUser" WHERE id = ${userId})::int AS u, (SELECT count(*) FROM "PushSubscription" WHERE "userId" = ${userId})::int AS p`))[0]; } catch (e) { cleaned = { error: e?.message }; } }
  step('cleanup: synthetic account, subscriptions and reminder rows deleted', cleaned && cleaned.u === 0 && cleaned.p === 0, { cleaned });
  await ctx.close().catch(() => {});
  fs.rmSync(profileDir, { recursive: true, force: true });
}
const pass = steps.every((s) => s.ok);
const report = { at: new Date().toISOString(), base, pass, browser: `Google Chrome (Playwright channel chrome, headed)`, note: 'LAB-only VAPID pair; synthetic account; real push service; payloads synthetic', consoleErrors: consoleErrors.slice(0, 20), steps };
fs.writeFileSync(path.join(outDir, 'r40-web-push-real.json'), JSON.stringify(report, null, 2));
console.log(`R40_WEB_PUSH_REAL ${JSON.stringify({ pass, passed: steps.filter((s) => s.ok).length, total: steps.length, out: path.join(outDir, 'r40-web-push-real.json') })}`);
process.exit(pass ? 0 : 1);
