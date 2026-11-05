/**
 * R46 citizen — on the BUILT app with the REAL API (scripts/lab-server.mjs → api/index.js) and a disposable LAB PostgreSQL (e2e-r46/citizen/seed.mjs), with the
 * LOCAL mock FranceConnect provider (scripts/lab/mock-franceconnect.mjs — not FranceConnect):
 *   password sign-in → Mon Espace notification centre (two derived notifications, no content, « read all ») → Mon profil › FranceConnect: link through the
 *   provider → linked → a fresh browser signs in WITH FranceConnect (linked account only) → the six languages (ar right to left, 375 px) on the sign-in
 *   button and the notification centre; axe WCAG 2.1 A/AA serious+critical = 0 on each screen; no request leaves 127.0.0.1.
 * Env: R46C_BASE (default http://127.0.0.1:5182), R46C_CREDS (the seed's credentials file, outside the repository — never printed),
 * R46C_GATE_ORIGIN (default http://127.0.0.1:5173: the API's SEC-03 origin gate admits that LAB origin only; the harness presents it on /api requests).
 */
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.R46C_BASE || 'http://127.0.0.1:5182';
const CREDS = JSON.parse(fs.readFileSync(process.env.R46C_CREDS || '', 'utf8'));
const GATE_ORIGIN = process.env.R46C_GATE_ORIGIN || 'http://127.0.0.1:5173';
const NOTIF_TITLE = { fr: 'Notifications', en: 'Notifications', tr: 'Bildirimler', ar: 'الإشعارات', de: 'Benachrichtigungen', uk: 'Сповіщення' };
const DEADLINE = { fr: 'Une échéance de Mon Parcours arrive dans moins de 7 jours.', en: 'A deadline in Mon Parcours is less than 7 days away.', tr: 'Mon Parcours’taki bir son tarihe 7 günden az kaldı.',
  ar: 'يحلّ موعد نهائي في Mon Parcours خلال أقل من 7 أيام.', de: 'Eine Frist in Mon Parcours endet in weniger als 7 Tagen.', uk: 'До кінцевого терміну в Mon Parcours менше 7 днів.' };
const FC_BUTTON = { fr: 'S’identifier avec FranceConnect', en: 'Sign in with FranceConnect', tr: 'FranceConnect ile giriş yap', ar: 'تسجيل الدخول عبر FranceConnect', de: 'Mit FranceConnect anmelden', uk: 'Увійти через FranceConnect' };

const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function newContext(browser, lang = 'fr', viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const external = [];
  context.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(u.host); });
  // as scripts/acceptance/r42-cdgg-booking-browser.mjs: a request that carries an Origin is replayed with the admitted LAB origin (Chrome does not let a route override it)
  await context.route(`${BASE}/api/**`, async (route) => {
    const h = await route.request().allHeaders();
    if (!h.origin) return route.continue();
    try { await route.fulfill({ response: await route.fetch({ headers: { ...h, origin: GATE_ORIGIN }, maxRedirects: 0 }) }); } catch { await route.abort().catch(() => {}); }
  });
  await context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
  return { context, external };
}

let fcSession = null;
test.describe.serial('R46 citizen: notifications and FranceConnect (mock provider)', () => {
  test('fr: password sign-in → notification centre → read all → link FranceConnect from the profile', async ({ browser }) => {
    const { context, external } = await newContext(browser);
    const page = await context.newPage();
    await page.goto(`${BASE}/auth/login?next=/compte`);
    await expect(page.getByTestId('fc-login')).toHaveText(FC_BUTTON.fr);   // available in the LAB (mock provider)
    await axeSerious(page, 'sign-in fr');
    await page.locator('#auth-email').fill(CREDS.citizen.email);
    await page.locator('#auth-password').fill(CREDS.citizen.password);
    await page.locator('form button[type=submit]').click();
    await expect(page.getByTestId('mon-espace')).toBeVisible({ timeout: 30000 });
    const center = page.getByTestId('notification-center');
    await expect(center).toBeVisible();
    await expect(center.getByTestId('notification-item')).toHaveCount(2);
    await expect(center.getByText(DEADLINE.fr)).toBeVisible();
    await expect(center.getByTestId('notifications-unread')).toBeVisible();
    await expect(center).not.toContainText('Étape synthétique');   // no title, no name in a notification
    await expect(center).not.toContainText('Mineur synthétique');
    await axeSerious(page, 'Mon Espace fr');
    await center.getByTestId('notifications-read-all').click();
    await expect(center.getByTestId('notifications-unread')).toHaveCount(0);
    await expect(center.getByRole('status')).toBeVisible();
    // the notification link opens the page under its own authorisation
    await center.getByRole('link', { name: DEADLINE.fr }).click();
    await expect(page).toHaveURL(/\/compte\/parcours$/);

    await page.goto(`${BASE}/compte/profil`);
    const card = page.getByTestId('fc-link');
    await expect(card.getByTestId('fc-status-not-linked')).toBeVisible({ timeout: 30000 });
    await axeSerious(page, 'profil fr (not linked)');
    await card.getByTestId('fc-link-start').click();
    await expect(page).toHaveURL(/\/compte\/profil\?fc=linked$/, { timeout: 30000 });
    await expect(page.getByTestId('fc-status-linked')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('fc-link').getByRole('status')).toBeVisible();
    await axeSerious(page, 'profil fr (linked)');
    expect(external).toEqual([]);
    await context.close();
  });

  test('fr: a fresh browser signs in WITH FranceConnect (linked account) and lands in Mon Espace', async ({ browser }) => {
    const { context, external } = await newContext(browser);
    const page = await context.newPage();
    await page.goto(`${BASE}/auth/login?next=/compte`);
    await page.getByTestId('fc-login').click();
    await expect(page.getByTestId('mon-espace')).toBeVisible({ timeout: 30000 });
    const cookies = await context.cookies(BASE);
    expect(cookies.find((c) => c.name === 'ada_user_session')?.httpOnly).toBe(true);
    expect(cookies.find((c) => c.name === 'ada_fc_flow')).toBeUndefined();   // one-use flow cookie cleared
    fcSession = cookies;   // reused below: the callback is rate-limited like a password sign-in (LOGIN_USER)
    expect(external).toEqual([]);
    await context.close();
  });

  for (const [lang, viewport] of [['en'], ['tr'], ['ar'], ['de'], ['uk'], ['ar', { width: 375, height: 812 }], ['fr', { width: 375, height: 812 }]]) {
    test(`${lang}${viewport ? ' 375 px' : ''}: FranceConnect button and notification centre translated${lang === 'ar' ? ', right to left' : ''}`, async ({ browser }) => {
      const { context, external } = await newContext(browser, lang, viewport);
      const page = await context.newPage();
      await page.goto(`${BASE}/auth/login?next=/compte`);
      await expect(page.getByTestId('fc-login')).toHaveText(FC_BUTTON[lang], { timeout: 30000 });
      if (lang === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await axeSerious(page, `sign-in ${lang}`);
      await context.addCookies(fcSession);   // the FranceConnect session of the previous test
      await page.goto(`${BASE}/compte`);
      const center = page.getByTestId('notification-center');
      await expect(center.getByRole('heading', { name: NOTIF_TITLE[lang] })).toBeVisible({ timeout: 30000 });
      await expect(center.getByText(DEADLINE[lang])).toBeVisible();
      await axeSerious(page, `Mon Espace ${lang}`);
      if (viewport) expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(external).toEqual([]);
      await context.close();
    });
  }

  test('an error code returned by the callback is explained on the sign-in page (no session)', async ({ browser }) => {
    const { context } = await newContext(browser);
    const page = await context.newPage();
    await page.goto(`${BASE}/auth/login?fc=not_linked`);
    await expect(page.getByTestId('fc-error')).toContainText('n’est liée à aucun compte');
    await axeSerious(page, 'sign-in fc error');
    await context.close();
  });
});
