/**
 * R46 / inst — on the BUILT app with the REAL API (api/index.js) and a disposable LAB PostgreSQL:
 *  - N10 « Fournisseurs et intégrations » and Q07 « Signaux de sécurité » for a named MFA administrator session, in six languages (ar right to left), desktop
 *    and a 375 px phone (M04): every provider listed with a translated state, no value shown, no sideways scroll, axe WCAG 2.1 A/AA serious+critical = 0;
 *    without a session both pages send to the administrator sign-in;
 *  - Q07: the help form offers the security category with its guidance (six languages) and /.well-known/security.txt is served (RFC 9116 fields).
 * Env: R46_BASE (default http://127.0.0.1:5184), R46_ADMIN_TOKEN (a signed LAB administrator session — never printed).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.R46_BASE || 'http://127.0.0.1:5184';
const TOKEN = process.env.R46_ADMIN_TOKEN || '';
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
const T = {
  providers: { fr: 'Fournisseurs et intégrations', en: 'Providers and integrations', tr: 'Sağlayıcılar ve entegrasyonlar', ar: 'المزوّدون والتكاملات', de: 'Anbieter und Integrationen', uk: 'Постачальники та інтеграції' },
  security: { fr: 'Signaux de sécurité', en: 'Security signals', tr: 'Güvenlik sinyalleri', ar: 'إشارات الأمان', de: 'Sicherheitssignale', uk: 'Сигнали безпеки' },
  simulated: { fr: 'Simulé', en: 'Simulated', tr: 'Simüle edildi', ar: 'مُحاكى', de: 'Simuliert', uk: 'Імітовано' },
  securityOption: { fr: 'Je signale un problème de sécurité (vulnérabilité)', en: 'I am reporting a security problem (vulnerability)', tr: 'Bir güvenlik sorunu (güvenlik açığı) bildiriyorum', ar: 'أبلّغ عن مشكلة أمنية (ثغرة)', de: 'Ich melde ein Sicherheitsproblem (Schwachstelle)', uk: 'Я повідомляю про проблему безпеки (вразливість)' },
};
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const ctx = async (browser, lang, { mobile = false, admin = true } = {}) => {
  const context = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  await context.addInitScript(([l, tok]) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); if (tok) sessionStorage.setItem('access_token', tok); } catch { /* storage refused */ } }, [lang, admin ? TOKEN : '']);
  return context;
};

test('without a session the two administrator pages send to the sign-in, and their API refuses', async ({ browser }) => {
  const context = await ctx(browser, 'fr', { admin: false }); const page = await context.newPage();
  for (const p of ['/admin/fournisseurs', '/admin/securite']) { await page.goto(`${BASE}${p}`); await expect(page).toHaveURL(/\/admin\/login$/); }
  for (const p of ['provider-status', 'security-signals']) expect((await context.request.get(`${BASE}/api/admin/${p}`)).status()).toBe(401);
  await context.close();
});

for (const mobile of [false, true]) {
  for (const lang of LANGS) {
    if (mobile && !['fr', 'ar'].includes(lang)) continue;
    test(`${lang} ${mobile ? 'mobile 375' : 'desktop'}: providers and security signals pages`, async ({ browser }) => {
      expect(TOKEN, 'R46_ADMIN_TOKEN').not.toBe('');
      const context = await ctx(browser, lang, { mobile }); const page = await context.newPage();
      await page.goto(`${BASE}/admin/fournisseurs`);
      await expect(page.getByRole('heading', { level: 1, name: T.providers[lang] })).toBeVisible({ timeout: 30000 });
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      for (const id of ['mail', 'sms', 'push', 'outlook', 'video', 'openfisca', 'aides-territoires', 'franceconnect', 'proconnect', 'maps', 'sentry', 'upstash', 'hosting', 'database']) await expect(page.getByTestId(`admin-provider-${id}`)).toBeVisible();
      // the LAB has no shared KV store: honestly « simulated », in the page language
      await expect(page.getByTestId('admin-provider-upstash-state')).toHaveText(T.simulated[lang]);
      await expect(page.getByTestId('admin-provider-upstash-state')).toHaveAttribute('data-state', 'SIMULATED');
      const html = await page.content();
      expect(html).not.toMatch(/postgres(ql)?:\/\//);
      expect(await overflow(page), 'no sideways scroll').toBeLessThanOrEqual(0);
      await axeSerious(page, `${lang} providers`);
      await page.goto(`${BASE}/admin/securite`);
      await expect(page.getByRole('heading', { level: 1, name: T.security[lang] })).toBeVisible({ timeout: 30000 });
      for (const id of ['failed-logins', 'mfa-failures', 'exports']) await expect(page.getByTestId(`admin-security-${id}-count`)).toHaveText(/^\d+$/);
      expect(await overflow(page), 'no sideways scroll').toBeLessThanOrEqual(0);
      await axeSerious(page, `${lang} security`);
      await context.close();
    });
  }
}

test('a refused sign-in is counted on the security page (real API, audit trail)', async ({ browser }) => {
  const context = await ctx(browser, 'fr'); const page = await context.newPage();
  await page.goto(`${BASE}/admin/securite`);
  const before = Number(await page.getByTestId('admin-security-failed-logins-count').textContent());
  const csrf = (await context.cookies()).find((c) => /csrf/i.test(c.name));
  const r = await context.request.post(`${BASE}/api/auth/login`, { data: { email: `nobody-${Date.now()}@example.test`, password: 'Wrong-password-1' }, headers: csrf ? { 'x-csrf-token': csrf.value } : {} });
  expect(r.status()).toBe(401);
  await page.reload();
  await expect(page.getByTestId('admin-security-failed-logins-count')).toHaveText(String(before + 1));
  await context.close();
});

for (const lang of LANGS) {
  test(`${lang}: the help form offers the security category with its guidance`, async ({ browser }) => {
    const context = await ctx(browser, lang, { admin: false }); const page = await context.newPage();
    await page.goto(`${BASE}/contact?sujet=securite`);
    await expect(page.getByTestId('contact-security-note')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#sujet')).toContainText(T.securityOption[lang]);
    await expect(page.locator('#page')).toBeVisible();
    await axeSerious(page, `${lang} contact security`);
    await context.close();
  });
}

test('/.well-known/security.txt is served as text with the RFC 9116 fields', async ({ request }) => {
  const r = await request.get(`${BASE}/.well-known/security.txt`);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^text\/plain/);
  const txt = await r.text();
  expect(txt).toMatch(/^Contact: https:\/\/accesdirectaide\.fr\/contact\?sujet=securite$/m);
  expect(txt).toMatch(/^Expires: 20\d\d-/m);
});
