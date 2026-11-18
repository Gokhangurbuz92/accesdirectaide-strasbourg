// @ts-nocheck
/**
 * FA-RTL — logical spacing on the seven surfaces (public, citizen, pro, structure, institution, admin, ops), checked in Arabic (rtl) and French (ltr) on the LAB server started
 * by e2e-r47/rgaa/run.sh (RGAA_CONFIG=e2e-r47/rgaa/rtl-logical.config.mjs). LAB_SYNTHETIC engineering evidence, never a human or RGAA review.
 * Per screen × language: full-page screenshot (RTL_SHOTS dir), axe wcag2a/aa/21a/21aa/22aa, no sideways scroll at 1280 px, and geometry:
 *  - the side navigation sits on the reading-start side (right in ar, left in fr) with its border toward the content;
 *  - every icon carrying a logical end margin (me-*) that precedes its label sits on the reading-start side of that label, separated from it (gap ≥ 2 px);
  *  - list bullets (ul/ol with ps-*) are indented on the reading-start side;
 *  - Radix Select triggers show their value on the reading-start side of the chevron, and an open listbox / menu runs in the reading direction.
 * Writes every row to RTL_OUT; fails only when a page cannot be reached.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import * as otp from 'otplib';

const C = JSON.parse(fs.readFileSync(process.env.R47_CREDS, 'utf8'));
const B = C.base;
if (new URL(B).hostname !== '127.0.0.1' || new URL(B).port === '3000') throw new Error('loopback LAB only, never :3000');
const SHOTS = process.env.RTL_SHOTS || 'test-results/rtl-logical';
fs.mkdirSync(SHOTS, { recursive: true });
const LANGS = (process.env.RTL_LANGS || 'ar,fr').split(',').filter(Boolean);
// public and citizen screens (shared src/components/ui primitives: SearchInput, Select, Dialog, Alert, Table, Toast, HideScreenButton); [surface, route, click-before-shot]
const SCREENS = [
  ['Public', '/'], ['Public', '/recherche?q=logement'], ['Public', '/aides'], ['Public', '/structures'], ['Public', '/contact', '#sujet'], ['Public', '/orientation'],
  ['Public', '/auth/login'], ['Public', '/confidentialite'],
  ['Citizen', '/compte'], ['Citizen', '/compte/parametres'], ['Citizen', '/compte/profil'], ['Citizen', '/compte/parcours'], ['Citizen', '/compte/coffre'],
  ['Citizen', '/compte/rendez-vous'], ['Citizen', '/compte/messages'], ['Citizen', '/compte/orientations'],
  ['Pro', '/pro/login'], ['Pro', '/pro/dashboard'], ['Pro', '/pro/dossiers'], ['Pro', '/pro/orientations'], ['Pro', '/pro/rdv/agenda'], ['Pro', '/pro/rdv/absences'],
  ['Pro', '/pro/messages'], ['Pro', '/pro/mfa-settings'], ['Pro', '/pro/audit', 'button[role="combobox"]'], ['Pro', '/pro/reports'], ['Pro', '/pro/regional'], ['Pro', '/pro/selections'], ['Pro', '/pro/parametres'],
  ['Structure', '/pro/structure'], ['Structure', '/pro/services'], ['Structure', '/pro/team', 'button[role="combobox"]'], ['Structure', '/pro/rdv/disponibilites'],
  ['Institution', '/institution'],
  ['Admin', '/admin/login'], ['Admin', '/admin/dashboard'], ['Admin', '/admin/review-queue'], ['Admin', '/admin/privacy'], ['Admin', '/admin/doublons'],
  ['Admin', '/admin/inbox'], ['Admin', '/admin/parametres'], ['Admin', '/admin/signalements'], ['Admin', '/admin/ws2'], ['Admin', '/admin/sources'], ['Admin', '/admin/appointments'], ['Admin', '/admin/orchestrator'], ['Admin', '/admin/audit'],
  ['Ops', '/admin/operations'], ['Ops', '/admin/observability'], ['Ops', '/admin/runs'], ['Ops', '/admin/data-quality'],
];
// iteration aid: RTL_ONLY=/compte/parametres,/pro/parametres runs only these screens
if (process.env.RTL_ONLY) { const only = new Set(process.env.RTL_ONLY.split(',')); for (let i = SCREENS.length - 1; i >= 0; i -= 1) if (!only.has(SCREENS[i][1])) SCREENS.splice(i, 1); }
const rows = [];

const CSRF = crypto.randomUUID(); let ipn = 0; const xff = () => `10.51.${Math.floor((ipn += 1) / 250) % 250}.${(ipn % 250) + 1}`;
let adminToken = null;
async function adminSession(request) {
  if (adminToken) return adminToken;
  const A = C.admins[0]; const h = { 'x-forwarded-for': xff(), 'x-csrf-token': CSRF, cookie: `__csrf=${CSRF}` };
  const l = await (await request.post(`${B}/api/admin/login`, { headers: h, data: { email: A.email, password: A.password } })).json();
  const v = await (await request.post(`${B}/api/admin/mfa-verify`, { headers: { ...h, 'x-forwarded-for': xff(), authorization: `Bearer ${l.token}` }, data: { code: otp.generateSync({ secret: A.secret }) } })).json();
  adminToken = v.token; expect(adminToken, 'admin session').toBeTruthy(); return adminToken;
}
async function contextFor(browser, request, surface, route, lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: lang, extraHTTPHeaders: { 'x-forwarded-for': xff() } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1');
    localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
  if (/login$/.test(route) || surface === 'Public') return ctx;
  if (surface === 'Citizen') await ctx.addCookies([{ name: 'ada_user_session', value: C.citizen.cookie, url: B, httpOnly: true, sameSite: 'Strict' }]);
  if (surface === 'Pro' || surface === 'Structure') await ctx.addInitScript((t) => { try { localStorage.setItem('pro_token', t); } catch { /* */ } }, C.pro.token);
  if (surface === 'Admin' || surface === 'Ops') { const t = await adminSession(request); await ctx.addInitScript((x) => { try { sessionStorage.setItem('access_token', x); } catch { /* */ } }, t); }
  return ctx;
}

test.afterAll(() => { if (process.env.RTL_OUT) fs.writeFileSync(process.env.RTL_OUT, JSON.stringify({ at: new Date().toISOString(), kind: 'LAB_SYNTHETIC', rows }, null, 1)); });

for (const lang of LANGS) {
  for (const [surface, route, click] of SCREENS) {
    test(`${lang} ${surface} ${route}`, async ({ browser, request }) => {
      const ctx = await contextFor(browser, request, surface, route, lang); const page = await ctx.newPage();
      const resp = await page.goto(B + route, { waitUntil: 'domcontentloaded' });
      expect(resp && resp.status(), `${route} reachable`).toBeLessThan(500);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      if (surface === 'Institution' && await page.locator('#inst-email').count()) {
        await page.locator('#inst-email').fill(C.institution.email); await page.locator('#inst-pass').fill(C.institution.password);
        await page.locator('form').filter({ has: page.locator('#inst-email') }).getByRole('button').first().click();
        await page.getByTestId('institution-space').waitFor({ timeout: 20000 }).catch(() => {});
      }
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      let opened = null;   // an interaction that opens a shared primitive (Select listbox) before the screenshot
      if (click) { await page.locator(click).first().focus().catch(() => {}); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
        opened = await page.locator('[role="listbox"], [role="menu"], [role="dialog"]').count() > 0; }
      const file = path.join(SHOTS, `${lang}_${surface}_${(route.replace(/^\//, '') || 'home').replace(/[^\w-]/g, '_')}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const geo = await page.evaluate(() => {
        const rtl = document.documentElement.dir === 'rtl'; const vw = document.documentElement.clientWidth; const out = { dir: document.documentElement.dir, problems: [], checked: 0 };
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        out.overflow = document.documentElement.scrollWidth - vw;
        const main = document.querySelector('main'); const aside = [...document.querySelectorAll('aside')].find((x) => vis(x) && !(main && main.contains(x)));   // the layout's side navigation, not a filter card inside main
        if (aside && main && vis(main)) { out.checked += 1; const a = aside.getBoundingClientRect(); const m = main.getBoundingClientRect(); const cs = getComputedStyle(aside);
          const ok = rtl ? (a.left >= m.right - 1 && parseFloat(cs.borderLeftWidth) > 0) : (a.right <= m.left + 1 && parseFloat(cs.borderRightWidth) > 0);
          if (!ok) out.problems.push(`aside side/border wrong (aside ${Math.round(a.left)}-${Math.round(a.right)}, main ${Math.round(m.left)}-${Math.round(m.right)}, bl ${cs.borderLeftWidth} br ${cs.borderRightWidth})`); }
        for (const svg of document.querySelectorAll('svg[class*="me-"], svg[class*="mr-"]')   /* mr-: so a physical margin left behind is caught too */) {
          if (!vis(svg)) continue; const parent = svg.parentElement; let next = svg.nextSibling;
          while (next && next.nodeType === 3 && !next.nodeValue.trim()) next = next.nextSibling;
          if (!next) continue; let r;
          if (next.nodeType === 3) { const rg = document.createRange(); rg.selectNodeContents(next); r = rg.getBoundingClientRect(); } else if (next.nodeType === 1 && vis(next)) r = next.getBoundingClientRect(); else continue;
          if (!r || r.width === 0) continue; out.checked += 1; const s = svg.getBoundingClientRect();
          const gap = rtl ? s.left - r.right : r.left - s.right;   // the me-* margin must separate the icon from its label
          if (gap < 2) out.problems.push(`icon not separated from its label on the reading side (gap ${Math.round(gap)} px) « ${(parent.textContent || '').trim().slice(0, 30)} »`);
        }
        for (const l of document.querySelectorAll('ul[class*="ps-"], ol[class*="ps-"], ul[class*="pl-"], ol[class*="pl-"]')) { if (!vis(l)) continue; out.checked += 1; const cs = getComputedStyle(l);
          if (rtl ? parseFloat(cs.paddingRight) === 0 : parseFloat(cs.paddingLeft) === 0) out.problems.push('list indent on the wrong side'); }
        // Radix comboboxes (Select): the value sits on the reading-start side of the chevron
        for (const cb of document.querySelectorAll('button[role="combobox"]')) { if (!vis(cb)) continue; const v = cb.querySelector('span'); const ic = cb.querySelector('svg');
          if (!v || !ic) continue; out.checked += 1; const a = v.getBoundingClientRect(); const b = ic.getBoundingClientRect();
          if (rtl ? a.left < b.right : a.right > b.left) out.problems.push(`combobox value on the wrong side of its chevron (dir=${cb.getAttribute('dir')})`); }
        // an open listbox / menu follows the reading direction
        for (const lb of document.querySelectorAll('[role="listbox"], [role="menu"]')) { if (!vis(lb)) continue; out.checked += 1; if (getComputedStyle(lb).direction !== (rtl ? 'rtl' : 'ltr')) out.problems.push(`${lb.getAttribute('role')} direction ${getComputedStyle(lb).direction}`); }
        // layout signature for build-to-build comparison: interactive / text / icon elements, rounded boxes
        out.layout = [...document.querySelectorAll('button, a, input, select, textarea, svg, h1, h2, h3, label, li, th, td, [role="option"], [role="dialog"], [role="listbox"]')]
          .filter(vis).slice(0, 2000).map((e) => { const b = e.getBoundingClientRect(); return `${e.tagName}|${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}`; });
        return out;
      });
      // Radix tabs: the next tab is reached with the arrow pointing in the reading direction (ArrowLeft in Arabic, ArrowRight in French)
      let tabs = null;
      const tab = page.locator('[role="tablist"] [role="tab"]');
      if (await tab.count() > 1) {
        const names = await tab.allInnerTexts(); await tab.first().click(); await page.waitForTimeout(200);
        await page.keyboard.press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight'); await page.waitForTimeout(250);   // Radix roving focus moves in a setTimeout
        const now = await page.evaluate(() => document.activeElement?.innerText || '');
        tabs = { dir: await page.locator('[role="tablist"]').first().evaluate((e) => e.closest('[dir]')?.getAttribute('dir') + (e.closest('[dir]') === document.documentElement ? ' (html)' : ' (radix root)')), expected: names[1], focused: now, ok: now.trim() === names[1].trim() };
        if (!tabs.ok) geo.problems.push(`tab arrow order: ${lang === 'ar' ? 'ArrowLeft' : 'ArrowRight'} focused « ${now.trim()} », expected « ${names[1].trim()} » (tablist dir=${tabs.dir})`);
      }
      const row = { lang, surface, route, opened, tabs, url: page.url(), screenshot: file, axe: axe.violations.map((v) => `${v.id}(${v.nodes.length})`), ...geo };
      row.pass = row.axe.length === 0 && geo.problems.length === 0 && geo.overflow <= 0 && geo.dir === (lang === 'ar' ? 'rtl' : 'ltr');
      rows.push(row); if (!row.pass) console.log('FINDING', JSON.stringify(row));
      await ctx.close();
    });
  }
}
