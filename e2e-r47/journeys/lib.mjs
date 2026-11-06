/**
 * R47 journeys — shared helpers. Every call goes to the REAL API of the LAB server (R47_BASE); nothing is routed, stubbed or replayed by the browser.
 * Each synthetic person gets their own documentation address (192.0.2.x, RFC 5737) so the real per-address limits apply per person.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { generateCode } from '../../api/lib/totp.js';

export const BASE = process.env.R47_BASE || 'http://127.0.0.1:5192';
export const BASE_ENF = process.env.R47_BASE_ENF || 'http://127.0.0.1:3192';
export const GRAPH = process.env.R47_GRAPH || 'http://127.0.0.1:5292';
export const SCHEMA = process.env.R47_SCHEMA || '0042';
export const HAS_0045 = SCHEMA === '0045';
export const CREDS = JSON.parse(fs.readFileSync(process.env.R47_CREDS || '', 'utf8'));
export const TOKENS = JSON.parse(fs.readFileSync(process.env.R47_TOKENS || '', 'utf8'));
for (const u of [BASE, BASE_ENF, GRAPH]) { const h = new URL(u); if (h.hostname !== '127.0.0.1' || h.port === '3000') throw new Error('loopback LAB only, never :3000'); }
export const SLUG = CREDS.structure.slug;
export const SVC_DIRECT = CREDS.services.direct.id;
export const SVC_APPROVAL = CREDS.services.approval.id;
export const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
export const STAMP = Date.now().toString(36);

// ── database (assertions only; the journeys never write the rows they check)
let pool = null;
export const db = async (q, p = []) => {
  if (!pool) { const u = new URL(process.env.R47_DB || ''); if (u.hostname !== '127.0.0.1' || !u.pathname.endsWith('_test')) throw new Error('local *_test database only'); pool = new pg.Pool({ connectionString: process.env.R47_DB, max: 2 }); }
  return (await pool.query(q, p)).rows;
};
export const closeDb = async () => { if (pool) { await pool.end(); pool = null; } };

// ── TOTP: one code per 30 s step and per member (the server's monotonic claim); the last step used is kept beside the credentials file
const STEPS = path.join(path.dirname(process.env.R47_CREDS || '.'), 'steps.json');
const readSteps = () => { try { return JSON.parse(fs.readFileSync(STEPS, 'utf8')); } catch { return {}; } };
export async function totp(secret, key) {
  const steps = readSteps();
  let s = Math.floor(Date.now() / 30000);
  while (s <= (steps[key] ?? -1)) { await new Promise((r) => setTimeout(r, 1000)); s = Math.floor(Date.now() / 30000); }
  steps[key] = s; fs.writeFileSync(STEPS, JSON.stringify(steps), { mode: 0o600 });
  return generateCode(secret, s);
}

export const lastStep = (key) => readSteps()[key];

// ── addresses: one per person
let ipSeq = 20;
export const nextIp = () => `192.0.2.${(ipSeq += 1)}`;
const IP_OF = {};
export const ipOf = (k) => (IP_OF[k] ||= nextIp());

// ── browser contexts
/** @param {import('@playwright/test').Browser} browser */
export async function person(browser, { ip = nextIp(), lang = 'fr', viewport = { width: 1280, height: 900 }, base = BASE } = {}) {
  const mobile = viewport.width < 500;
  const context = await browser.newContext({ viewport, extraHTTPHeaders: { 'x-forwarded-for': ip }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const external = []; const serverErrors = []; const closedCapabilities = new Set();
  context.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.hostname !== '127.0.0.1') external.push(u.host); });
  // a 5xx of the API is a defect, EXCEPT the designed 503 CAPABILITY_NOT_OPEN of a capability closed by the Production gate (recorded apart)
  context.on('response', async (r) => {
    const u = new URL(r.url()); if (!u.pathname.startsWith('/api/') || r.status() < 500) return;
    const body = await r.json().catch(() => null);
    if (r.status() === 503 && body?.code === 'CAPABILITY_NOT_OPEN') closedCapabilities.add(`${u.pathname} (${body.capability})`); else serverErrors.push(`${r.status()} ${u.pathname}`);
  });
  await context.addInitScript((l) => {
    try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* storage refused */ }
  }, lang);
  /** the person's own API calls with the browser's cookies (session + CSRF double-submit pair), as the page makes them */
  const api = async (method, p, body) => {
    let csrf = (await context.cookies(base)).find((c) => c.name === '__csrf')?.value;
    if (!csrf && method !== 'GET') { await context.request.get(`${base}/api/health/live`); csrf = (await context.cookies(base)).find((c) => c.name === '__csrf')?.value; }
    const r = await context.request.fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', origin: base, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0 });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status(), json, headers: r.headers() };
  };
  return { context, api, external, serverErrors, closedCapabilities, ip, base };
}

// ── professional sessions over HTTP (password + TOTP), from the member's own address
const proTokens = new Map();
export async function proLogin(k, { fresh = false, base = BASE } = {}) {
  const key = `${base}|${k}`;
  if (!fresh && proTokens.has(key)) return proTokens.get(key);
  const p = CREDS.pros[k];
  const h = { 'content-type': 'application/json', 'x-forwarded-for': ipOf(`pro:${k}`) };
  const r = await fetch(`${base}/api/pro/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ email: p.email, password: p.password }) });
  const j = await r.json();
  let token = j.token;
  if (j.mfa_required) {
    const first = await fetch(`${base}/api/health/live`, { headers: h }); const csrf = (/__csrf=([^;]+)/.exec(first.headers.get('set-cookie') || '') || [])[1] || '';
    const v = await (await fetch(`${base}/api/pro/auth/mfa-verify`, { method: 'POST', headers: { ...h, cookie: `__csrf=${csrf}`, 'x-csrf-token': csrf, origin: base },
      body: JSON.stringify({ mfa_token: j.mfa_token, code: await totp(p.totpSecret, k) }) })).json();
    token = v.token;
  }
  if (!token) throw new Error(`pro sign-in failed for ${k}: ${r.status}`);
  proTokens.set(key, token);
  return token;
}
export const forgetPro = (k) => { for (const key of [...proTokens.keys()]) if (key.endsWith(`|${k}`)) proTokens.delete(key); };
export async function bearer(token, method, p, body, { ip = '192.0.2.250', base = BASE } = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: Object.fromEntries(r.headers) };
}
export const papi = async (k, method, p, body, o = {}) => bearer(await proLogin(k, o), method, p, body, { ip: ipOf(`pro:${k}`), ...o });
export const aapi = (name, method, p, body, o = {}) => bearer(TOKENS[name], method, p, body, { ip: '192.0.2.240', ...o });

// ── browser sign-ins (the real forms)
export async function citizenSignIn(page, who, next = '/compte', base = BASE) {
  await page.goto(`${base}/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator('#auth-email').fill(who.email);
  await page.locator('#auth-password').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 30000 });
}
export async function proSignIn(page, k, { secret, email, password, next = '/pro/dashboard', base = BASE } = {}) {
  const p = CREDS.pros[k] || {};
  await page.goto(`${base}/pro/login?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(email || p.email); await page.locator('#password').fill(password || p.password);
  await page.getByRole('button', { name: /Se connecter/ }).first().click();
  await page.locator('#mfa-code').fill(await totp(secret || p.totpSecret, k));
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await page.waitForURL((u) => u.pathname === next.split('?')[0], { timeout: 30000 });
}

// ── mail (the LAB server's test outbox)
export const outbox = async (to, base = BASE) => (await (await fetch(`${base}/__lab/outbox?to=${encodeURIComponent(to)}`)).json());
export const linkIn = (mails, re) => { for (const m of [...mails].reverse()) { const x = re.exec(m.text || ''); if (x) return x; } return null; };

// ── accessibility, layout
export async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(200);
}
export async function axe(page, label) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
}
export const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ── calendar
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export const parisDay = (d) => PARIS_DAY.format(new Date(d));
export const parisHM = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
export const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
/** every offered slot of a service up to 60 days ahead, window by window (14 days), as the citizen's page asks for them */
export async function allSlots(who, serviceId, { slug = SLUG, professional, from = 0, windows = 5 } = {}) {
  const today = parisDay(Date.now()); const out = [];
  for (let k = from; k < windows; k += 1) {
    const f = addDays(today, 14 * k); const t = addDays(f, 13);
    const r = await who.api('GET', `/api/rdv/structures/${slug}/slots?serviceId=${encodeURIComponent(serviceId)}&from=${f}&to=${t}${professional ? `&professional=${encodeURIComponent(professional)}` : ''}`);
    if (r.status !== 200) throw new Error(`slots ${r.status} ${JSON.stringify(r.json)}`);
    out.push(...r.json.slots);
  }
  return out;
}
/** a slot at least `minHours` ahead (reschedule needs 24 h notice), skipping the ones in `avoid` */
export const pickSlot = (slots, { minHours = 30, avoid = [], nth = 0 } = {}) => slots.filter((s) => Date.parse(s.startAt) > Date.now() + minHours * 3600_000 && !avoid.includes(s.startAt))[nth];
export const book = (who, serviceId, startAt, extra = {}, slug = SLUG) => who.api('POST', '/api/rdv/appointments', { structureSlug: slug, serviceId, startAt, idempotencyKey: `r47-${STAMP}-${Math.random().toString(36).slice(2)}`, ...extra });

// ── the notice ledger as the schema allows it (0045 kinds are skipped, not invented, on a 0042 database)
export const LEDGER_0045 = ['BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED'];
export const notices = (id) => db(`SELECT kind, recipient, channel, status FROM "AppointmentNotice" WHERE "appointmentId" = $1 ORDER BY "createdAt", kind, recipient, channel`, [id]);
/** the in-app notifications of the structure's members about one appointment (ProNotification, the R20 catalogue) */
export const proNotices = (id) => db(`SELECT type, "userId" FROM "ProNotification" WHERE metadata->>'appointmentId' = $1`, [id]);
export const expectNotice = async (id, kind, recipient, channel = 'email') => {
  const read = async () => (await notices(id)).filter((n) => n.kind === kind && n.recipient === recipient && n.channel === channel);
  // a decision taken in the browser answers after the status change; the notice row follows the e-mail hand-over: read it again for a few seconds
  if (LEDGER_0045.includes(kind) && !HAS_0045) { await new Promise((r) => setTimeout(r, 500)); expect(await read(), `${kind} is not recorded without 0045`).toHaveLength(0); return []; }
  await expect.poll(async () => (await read()).length, { message: `${kind} ${recipient} ${channel} notice`, timeout: 10000 }).toBeGreaterThanOrEqual(1);
  return read();
};
/** no e-mail address, no free text of the journeys, no name of a person in an AuditLog row's details */
export async function auditWithoutPersonalData(since, extraNeedles = []) {
  const rows = await db(`SELECT action, actor, target, details::text AS d FROM "AuditLog" WHERE "timestamp" >= $1`, [since]);
  const needles = [...Object.values(CREDS.citizens).flatMap((c) => [c.email, c.name]), ...extraNeedles].filter(Boolean).map((s) => String(s).toLowerCase());
  const leaks = rows.filter((r) => /@[a-z0-9.-]+\.[a-z]{2,}/i.test(`${r.d || ''} ${r.target || ''}`) || needles.some((n) => `${r.d || ''} ${r.target || ''}`.toLowerCase().includes(n))).map((r) => `${r.action}: ${String(r.d).slice(0, 160)}`);
  return { rows, leaks };
}
