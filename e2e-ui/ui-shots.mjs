/**
 * UI modernisation — screenshots of the citizen screens at the phone / tablet / foldable / desktop / wide widths, light and dark.
 * Run against a dev server whose /api is a synthetic mock (no database, no secret, never :3000):
 *   UI_BASE=http://127.0.0.1:5191 UI_SHOTS=<dir> node e2e-ui/ui-shots.mjs
 * Uses the installed Chrome (channel chrome). Synthetic account only (citoyen.fixture@example.test).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5191';
if (/:3000\b/.test(BASE)) throw new Error('ui-shots: port 3000 is the owner LAB');
const OUT = process.env.UI_SHOTS || 'ui-shots';
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = { phone: [375, 812], fold: [717, 512], tablet: [768, 1024], desktop: [1280, 800], wide: [1700, 950] };
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'espace', path: '/compte', wait: '[data-testid="mon-espace"]' },
  { name: 'parametres', path: '/compte/parametres', wait: 'h1' },
  { name: 'parametres-donnees', path: '/compte/parametres', wait: 'h1', tab: /Données|Data/ },
  { name: 'ferme', path: '/compte/entraide', wait: 'h1' },
];
const PLAN = [
  ...['phone', 'tablet', 'desktop', 'wide'].flatMap((w) => PAGES.slice(0, 4).map((p) => ({ ...p, w, theme: 'light' }))),
  { ...PAGES[1], w: 'fold', theme: 'light' }, { ...PAGES[2], w: 'fold', theme: 'light' },
  ...['phone', 'desktop'].flatMap((w) => PAGES.slice(0, 4).map((p) => ({ ...p, w, theme: 'dark' }))),
  { ...PAGES[4], w: 'desktop', theme: 'light' },
  { ...PAGES[1], w: 'desktop', theme: 'light', menu: true, name: 'espace-menu-compte' },
];

// UI_SET=pro: the ADA Pro screens (synthetic administrator of « CCAS Fixture »; the mock /api/pro/me opens the agenda, messages and observatory only)
const PRO = ['dashboard', 'team', 'audit', 'reports', 'structure', 'rdv/agenda', 'rdv/new', 'rdv/services', 'rdv/disponibilites', 'rdv/absences', 'messages', 'regional', 'parametres']
  .map((x) => ({ name: `pro-${x.replace('/', '-')}`, path: `/pro/${x}`, wait: 'main h1' }));
if (process.env.UI_SET === 'pro') {
  PLAN.length = 0;
  PLAN.push(...PRO.map((p) => ({ ...p, w: 'desktop', theme: 'light' })));
  PLAN.push(...['dashboard', 'audit', 'rdv-absences'].map((n) => ({ ...PRO.find((p) => p.name === `pro-${n}`), w: 'phone', theme: 'light' })));
  PLAN.push({ ...PRO[0], w: 'tablet', theme: 'light' }, { ...PRO[0], w: 'wide', theme: 'light' }, { ...PRO[0], w: 'desktop', theme: 'dark' }, { ...PRO[2], w: 'desktop', theme: 'dark' });
  PLAN.push({ ...PRO[0], w: 'phone', theme: 'light', proMenu: true, name: 'pro-dashboard-menu' });
}
const browser = await chromium.launch({ channel: process.env.UI_CHANNEL || 'chrome' });
const ONLY = process.env.UI_ONLY ? new RegExp(process.env.UI_ONLY) : null;   // e.g. UI_ONLY='espace_(desktop|phone)'
for (const s of PLAN) {
  if (ONLY && !ONLY.test(`${s.name}_${s.w}_${s.theme}`)) continue;
  const [width, height] = WIDTHS[s.w];
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: s.theme, locale: 'fr-FR', serviceWorkers: 'block' });
  await context.addInitScript((theme) => {
    try {
      localStorage.setItem('ada_onboarding_done', 'true');
      localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() }));
      localStorage.setItem('ada-theme', theme);
      localStorage.setItem('pro_token', 'synthetic-fixture-token');
    } catch { /* */ }
  }, s.theme);
  const page = await context.newPage();
  await page.goto(BASE + s.path, { waitUntil: 'networkidle' });
  if (s.wait) await page.waitForSelector(s.wait, { timeout: 20000 }).catch(() => {});
  if (s.tab) await page.getByRole('tab', { name: s.tab }).click();
  if (s.proMenu) await page.getByTestId('pro-mobile-menu').click().catch(() => {});
  if (s.menu) await page.locator('header').getByRole('button', { name: /citoyen\.fixture/ }).first().click().catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${s.name}_${s.w}_${s.theme}.png`), fullPage: !s.menu && !s.proMenu });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) console.log(`OVERFLOW ${overflow}px  ${s.name} ${s.w} ${s.theme}`);
  await context.close();
}
await browser.close();
console.log('shots in', OUT);
