/**
 * FA-D1 browser suite — shared helpers. Every call goes to the REAL API of the LAB servers started by e2e-fa1/run-lab.mjs (FA1_BASE: surfaces of the journey
 * open; FA1_BASE_CLOSED: the Production default, restricted beta with nothing open). The application's API is never mocked; the only page.route use is the
 * explicit NETWORK-LOSS simulation (route.abort), named as such where it happens. Each synthetic person gets their own documentation address (192.0.2.x,
 * RFC 5737) so the real per-address limits apply per person. Everything is LAB_SYNTHETIC: fictional people, organisations and answers.
 */
import fs from 'node:fs';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';

export const BASE = process.env.FA1_BASE || 'http://127.0.0.1:5196';
export const BASE_CLOSED = process.env.FA1_BASE_CLOSED || 'http://127.0.0.1:5197';
for (const u of [BASE, BASE_CLOSED]) { const h = new URL(u); if (h.hostname !== '127.0.0.1' || h.port === '3000') throw new Error('loopback LAB only, never :3000'); }
export const CREDS = JSON.parse(fs.readFileSync(process.env.FA1_CREDS || '', 'utf8'));
export const TOKENS = JSON.parse(fs.readFileSync(process.env.FA1_TOKENS || '', 'utf8'));
export const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
export const LABEL = 'LAB_SYNTHETIC';

// ── database (assertions only)
let pool = null;
export const db = async (q, p = []) => {
  if (!pool) { const u = new URL(process.env.FA1_DB || ''); if (u.hostname !== '127.0.0.1' || !u.pathname.endsWith('_test')) throw new Error('local *_test database only'); pool = new pg.Pool({ connectionString: process.env.FA1_DB, max: 2 }); }
  return (await pool.query(q, p)).rows;
};
export const closeDb = async () => { if (pool) { await pool.end(); pool = null; } };

let ipSeq = 60;
export const nextIp = () => `192.0.2.${(ipSeq += 1)}`;

/**
 * A synthetic person with their own browser context. `allow503` lists the designed refusals of a closed surface / capability that the scenario expects;
 * any other API 5xx is recorded as a defect.
 * @param {import('@playwright/test').Browser} browser
 */
export async function person(browser, { ip = nextIp(), lang = 'fr', viewport = { width: 1280, height: 900 }, base = BASE, allow503 = [], deviceScaleFactor = 1 } = {}) {
  // a capability left closed by the Production gate (e.g. citizen.history, outside this journey) answers its designed 503: recorded apart, as in e2e-r47
  allow503 = [...allow503, 'CAPABILITY_NOT_OPEN'];
  const mobile = viewport.width < 500;
  const context = await browser.newContext({ viewport, deviceScaleFactor, extraHTTPHeaders: { 'x-forwarded-for': ip }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const external = []; const serverErrors = []; const designed = [];
  context.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.hostname !== '127.0.0.1') external.push(u.host); });
  context.on('response', async (r) => {
    const u = new URL(r.url()); if (!u.pathname.startsWith('/api/') || r.status() < 500) return;
    const body = await r.json().catch(() => null);
    const code = body?.code || body?.error;
    if (r.status() === 503 && allow503.includes(code)) designed.push(`${u.pathname} ${code}`); else serverErrors.push(`${r.status()} ${u.pathname} ${code || ''}`);
  });
  await context.addInitScript((l) => {
    try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* storage refused */ }
  }, lang);
  /** the person's own API call with the browser's cookies (session + CSRF double-submit pair), exactly as the page makes it */
  const api = async (method, p, body) => {
    let csrf = (await context.cookies(base)).find((c) => c.name === '__csrf')?.value;
    if (!csrf && method !== 'GET') { await context.request.get(`${base}/api/health/live`); csrf = (await context.cookies(base)).find((c) => c.name === '__csrf')?.value; }
    const r = await context.request.fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', origin: base, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0 });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status(), json };
  };
  return { context, api, external, serverErrors, designed, ip, base };
}

/** a bearer call through the real API entry (organisations, institution, administrators: sessions signed with this run's secrets by run-lab.mjs) */
export async function bearer(tokenName, method, p, body, { ip = '192.0.2.250', base = BASE } = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKENS[tokenName]}`, 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

export async function citizenSignIn(page, who, next = '/compte', base = BASE) {
  await page.goto(`${base}/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator('#auth-email').fill(who.email);
  await page.locator('#auth-password').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 30000 });
}

export const outbox = async (to, base = BASE) => (await (await fetch(`${base}/__lab/outbox?to=${encodeURIComponent(to)}`)).json());

export async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {});
  // cand-fa: framer-motion runs a DELAYED fade (EmptyState heading: delay 0.2 s) on a JS timer — it is not in document.getAnimations() during the delay, and axe
  // then measured « Aucun résultat » at inline opacity 0 (contrast 2.02). Also wait until no element of the main content is mid-fade (inline opacity < 1).
  await page.waitForFunction(() => [...document.querySelectorAll('main [style*="opacity"]')].every((el) => el.style.opacity === '' || Number(el.style.opacity) >= 1), null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
}
export async function axe(page, label) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
}
export const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** the French default of a key must not be the text shown in another interface language */
export const notFrench = async (locator, french, lang) => { if (lang !== 'fr') await expect(locator).not.toHaveText(french); };

/** one line of the persona × step × evidence × result matrix (printed; collected by the report from the JSON reporter's stdout) */
export function evidence(persona, step, ev, result = 'PASS') {
  console.log(`[FA1-MATRIX ${LABEL}] ${JSON.stringify({ persona, step, evidence: ev, result })}`);
}

/**
 * The FINAL answer of a request the page makes: a protected POST may first be refused 403 while the CSRF pair is being set, then sent again by the client
 * (src/lib/csrf.ts, src/lib/searchClient.js) — that designed first refusal is skipped, any other status is returned as is.
 * @param {import('@playwright/test').Page} page @param {(u: string, method: string) => boolean} match
 */
export function finalResponse(page, match, timeout = 30000) {
  return page.waitForResponse(async (r) => {
    if (!match(r.url(), r.request().method())) return false;
    if (r.status() !== 403) return true;
    const b = await r.json().catch(() => null);
    return !/csrf/i.test(JSON.stringify(b || {}));
  }, { timeout });
}
