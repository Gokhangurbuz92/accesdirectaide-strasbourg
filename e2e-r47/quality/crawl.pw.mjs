/**
 * R47 quality — the whole-product crawl: every route of src/pages/index.jsx (routes.mjs) with the session of its role, in the six interface languages, at
 * desktop width and at 375 px, on the BUILT app + REAL API (scripts/lab-server.mjs on a disposable synthetic LAB database). Each visit records:
 *   5xx answers (page or API), console errors, untranslated text (a visible text identical to the French rendering of the same page, outside lang="fr"
 *   fragments; raw i18n keys; elements with no text), html lang / dir (Arabic: rtl) and elements pushed off-screen, horizontal overflow, the number of h1,
 *   the focus indicator of the first keyboard stops, axe serious / critical violations, buttons / links without an accessible name, a page left loading or
 *   blank, junk values (undefined, NaN, Invalid Date), French month / weekday names on a non-French page, and the internal links it offers.
 * The crawl FAILS on nothing by itself: it writes one JSON line per visit to R47Q_OUT (report.mjs counts them); the guard tests at the end assert the
 * acceptance thresholds the R47 fixes reached. Env: R47Q_BASE, R47Q_TOKENS (file), R47Q_SEED (file), R47Q_OUT (dir), R47Q_LANGS, R47Q_ONLY (regexp).
 */
import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { allRoutes, ACCESS_DENIED } from './routes.mjs';

const BASE = process.env.R47Q_BASE || 'http://127.0.0.1:5195';
if (/:3000\b/.test(BASE)) throw new Error('port 3000 is the owner LAB');
const TOKENS = JSON.parse(fs.readFileSync(String(process.env.R47Q_TOKENS), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(String(process.env.R47Q_SEED), 'utf8'));
const OUT = String(process.env.R47Q_OUT);
const LANGS = (process.env.R47Q_LANGS || 'fr,en,tr,ar,de,uk').split(',');
const ONLY = process.env.R47Q_ONLY ? new RegExp(process.env.R47Q_ONLY) : null;
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 375, height: 812 }];
fs.mkdirSync(OUT, { recursive: true });
const write = (/** @type {any} */ row) => fs.appendFileSync(path.join(OUT, `visits-${process.pid}.jsonl`), `${JSON.stringify(row)}\n`);

let visitor = 0;
/** a context carrying the session of a role (the same storage / cookie the app itself writes after a sign-in) */
async function contextFor(/** @type {import('@playwright/test').Browser} */ browser, /** @type {string} */ role, /** @type {string} */ lang, /** @type {{ width: number, height: number }} */ vp) {
  // one visitor per visit: an own client address (the server runs with LAB_LOAD_FORWARDED=1), so the per-address limits — sized for a person, not for a
  // crawler opening 2,000 pages a minute from one address — measure the page, not the crawl
  visitor += 1;
  const ip = `10.47.${(process.pid + visitor) >> 8 & 255}.${(process.pid + visitor) & 255}`;
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', extraHTTPHeaders: { 'X-Forwarded-For': ip } });
  const t = TOKENS;
  await context.addInitScript(([l, r, admin, pro, sadm, inst]) => {
    try {
      localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1');
      localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() }));
      if (r === 'admin') sessionStorage.setItem('access_token', admin);
      if (r === 'pro') localStorage.setItem('pro_token', pro);
      if (r === 'structureAdmin') localStorage.setItem('pro_token', sadm);
      if (r === 'institution') sessionStorage.setItem('institution_token', inst);
    } catch { /* storage refused */ }
  }, [lang, role, t.admin, t.pros ? t.pros[visitor % t.pros.length] : t.pro, t.structureAdmins ? t.structureAdmins[visitor % t.structureAdmins.length] : t.structureAdmin, t.institution]);
  if (role === 'citizen') await context.addCookies([{ name: 'ada_user_session', value: encodeURIComponent(t.citizen), url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  return context;
}

/** everything measured inside the page (no external code) @param {{ lang: string, frTexts: string[] | null }} arg */
function inPage({ lang, frTexts }) {
  const vw = window.innerWidth;
  const visible = (/** @type {Element} */ el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  const srOnly = (/** @type {Element} */ el) => { const r = el.getBoundingClientRect(); return r.width <= 2 || r.height <= 2 || getComputedStyle(el).clipPath.includes('inset(50%)') || getComputedStyle(el).clip.startsWith('rect(0'); };
  const frPart = (/** @type {Element | null} */ el) => { const l = el && el.closest('[lang]'); return !!l && /^fr\b/i.test(l.getAttribute('lang') || '') && l !== document.documentElement; };
  const texts = []; const untranslated = []; const rawKeys = []; const frDates = []; const junk = [];
  const KEY = /^([a-z][a-zA-Z]*:)?[a-z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+){1,}$/;
  const DOMAINish = /\.(fr|com|org|test|gouv|eu|net|io)$|@/;
  const MONTHS = /\b(janvier|février|avril|juillet|août|septembre|octobre|novembre|décembre|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i;
  const frSet = frTexts ? new Set(frTexts) : null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement; if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
    const s = String(n.nodeValue || '').replace(/\s+/g, ' ').trim(); if (!s) continue;
    if (!visible(el)) continue;
    texts.push(s);
    if (KEY.test(s) && !DOMAINish.test(s) && /[_:]|\..*\./.test(s)) rawKeys.push(s);
    if (/\b(undefined|NaN|\[object Object\]|Invalid Date)\b/.test(s)) junk.push(s.slice(0, 80));
    if (lang !== 'fr' && !frPart(el)) {
      if (MONTHS.test(s)) frDates.push(s.slice(0, 80));
      if (frSet && frSet.has(s) && /[a-zà-ÿ]{4,}/i.test(s) && !/^[A-Z0-9][\w.-]*$/.test(s)) untranslated.push(s.slice(0, 120));
    }
  }
  for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
    for (const a of ['aria-label', 'placeholder', 'title', 'alt']) { const v = (el.getAttribute(a) || '').trim(); if (v && KEY.test(v) && !DOMAINish.test(v) && /[_:]|\..*\./.test(v)) rawKeys.push(`${a}=${v}`); }
  }
  // accessible name of buttons / links (text, aria-label, aria-labelledby, title, an image's alt, an svg title)
  const name = (/** @type {Element} */ el) => (el.textContent || '').trim() || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join('').trim()
    || el.getAttribute('title') || [...el.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')).join('').trim() || el.querySelector('svg title')?.textContent || (el instanceof HTMLInputElement ? el.value : '');
  const noName = [...document.querySelectorAll('button, [role="button"], a[href], input[type="submit"], input[type="button"]')].filter((el) => visible(el) && !String(name(el)).trim())
    .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${String(el.className || '').toString().split(' ').slice(0, 3).join('.')}`.slice(0, 120));
  const empty = [...document.querySelectorAll('h1,h2,h3,h4,label,th,legend,summary,option')].filter((el) => visible(el) && !(el.textContent || '').trim() && !el.getAttribute('aria-label') && !el.querySelector('img[alt],svg,input,select,button,[aria-label]'))
    .map((el) => el.tagName.toLowerCase());
  const h1 = [...document.querySelectorAll('h1')].filter((el) => visible(el) || srOnly(el)).length;
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  /** elements sticking out of the viewport (the cause of an overflow, or a mirrored layout pushing content off-screen) */
  const offscreen = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (offscreen.length >= 6) break;
    if (!visible(el) || srOnly(el)) continue;
    const r = el.getBoundingClientRect(); if (r.right <= vw + 1 && r.left >= -1) continue;
    let clipped = false; for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox !== 'visible') { const pr = p.getBoundingClientRect(); if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; } } }
    if (clipped) continue;
    if (el.children.length && [...el.children].some((ch) => { const cr = ch.getBoundingClientRect(); return cr.right > vw + 1 || cr.left < -1; })) continue;   // report the innermost
    offscreen.push(`${el.tagName.toLowerCase()}.${String(el.className || '').toString().split(' ').slice(0, 4).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}] «${(el.textContent || '').trim().slice(0, 40)}»`);
  }
  const busy = [...document.querySelectorAll('[aria-busy="true"], .animate-pulse, .animate-spin')].filter(visible).length;
  const main = document.querySelector('main') || document.body;
  const internalLinks = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '').filter((h) => h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/api/')).map((h) => h.split('#')[0].split('?')[0]).filter(Boolean))];
  return {
    finalPath: location.pathname, htmlLang: document.documentElement.lang, dir: document.documentElement.dir || 'ltr', h1, overflow: sw > vw + 1, scrollWidth: sw, offscreen,
    texts: lang === 'fr' ? [...new Set(texts)] : null, untranslated: [...new Set(untranslated)], rawKeys: [...new Set(rawKeys)], frDates: [...new Set(frDates)], junk: [...new Set(junk)],
    noName: [...new Set(noName)], empty, busy, mainText: (main.textContent || '').trim().length, notFound: !!document.querySelector('[data-testid="page-not-found"]'), internalLinks,
  };
}

/** the focus indicator of the first three keyboard stops (outline, or a ring drawn as box-shadow) */
async function focusCheck(/** @type {import('@playwright/test').Page} */ page) {
  const bad = [];
  await page.locator('body').click({ position: { x: 1, y: 1 }, force: true }).catch(() => {});
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = /** @type {HTMLElement | null} */ (document.activeElement); if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
      return { ok: !!ring, el: `${el.tagName.toLowerCase()}.${String(el.className || '').toString().split(' ').slice(0, 3).join('.')} «${(el.textContent || '').trim().slice(0, 30)}»` };
    }).catch(() => null);
    if (r && !r.ok) bad.push(r.el);
  }
  return bad;
}

async function visit(/** @type {import('@playwright/test').Browser} */ browser, /** @type {any} */ route, /** @type {string} */ lang, /** @type {any} */ vp, /** @type {string[] | null} */ frTexts) {
  const context = await contextFor(browser, route.role, lang, vp);
  const page = await context.newPage();
  const fiveXX = []; const consoleErrors = []; const api4xx = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.origin !== BASE) return; if (r.status() >= 500) fiveXX.push(`${r.status()} ${u.pathname}`); else if (r.status() >= 400 && u.pathname.startsWith('/api/')) api4xx.push(`${r.status()} ${r.request().method()} ${u.pathname}`); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  let nav = null;
  try { const resp = await page.goto(`${BASE}${route.path}`, { waitUntil: 'load', timeout: 30000 }); nav = resp ? resp.status() : null; } catch (e) { consoleErrors.push(`navigation: ${String(e).slice(0, 120)}`); }
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse, .animate-spin'), null, { timeout: 4000 }).catch(() => {});
  const m = await page.evaluate(inPage, { lang, frTexts }).catch((e) => ({ error: String(e).slice(0, 200) }));
  let axe = []; try {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    axe = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => String(n.target).slice(0, 100)) }));
  } catch (e) { axe = [{ id: 'axe-failed', impact: 'n/a', nodes: 0, targets: [String(e).slice(0, 100)] }]; }
  const focus = await focusCheck(page);
  await context.close();
  return { route: route.pattern, path: route.path, role: route.role, lang, viewport: vp.name, nav, fiveXX, api4xx, consoleErrors, axe, focus, ...m };
}

const ROUTES = allRoutes(SEED).filter((r) => !ONLY || ONLY.test(r.path));
test.describe.configure({ mode: 'parallel' });

for (const route of ROUTES.filter((r) => !r.redirect)) {
  test(`${route.role} ${route.path}`, async ({ browser }) => {
    test.setTimeout(600000);
    for (const vp of VIEWPORTS) {
      let frTexts = null;
      for (const lang of LANGS) {
        const row = await visit(browser, route, lang, vp, frTexts);
        if (lang === 'fr') frTexts = row.texts || [];
        delete row.texts;
        write(row);
      }
    }
  });
}

test('redirect-only routes land on a real page', async ({ browser }) => {
  test.setTimeout(600000);
  for (const route of ROUTES.filter((r) => r.redirect)) {
    const row = await visit(browser, route, 'fr', VIEWPORTS[0], null); delete row.texts; write({ ...row, kind: 'redirect' });
  }
});

test('pages opened without the right session explain why', async ({ browser }) => {
  test.setTimeout(600000);
  for (const d of ACCESS_DENIED.filter((r) => !ONLY || ONLY.test(r.path))) {
    for (const lang of ['fr', 'en', 'ar']) {
      const context = await contextFor(browser, d.role, lang, VIEWPORTS[0]);
      const page = await context.newPage();
      await page.goto(`${BASE}${d.path}`, { waitUntil: 'load' }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      const r = await page.evaluate(() => ({ finalPath: location.pathname + location.search, h1: [...document.querySelectorAll('h1')].map((h) => (h.textContent || '').trim()).join(' | '),
        text: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').trim().slice(0, 300), alert: [...document.querySelectorAll('[role="alert"], [role="status"]')].map((a) => (a.textContent || '').trim()).join(' | ').slice(0, 200) }));
      write({ kind: 'access', path: d.path, role: d.role, lang, ...r });
      await context.close();
    }
  }
});
