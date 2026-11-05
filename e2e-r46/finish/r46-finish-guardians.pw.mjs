/**
 * R46 / C05 — the verifier's page « Représentants légaux : vérification renforcée » on the BUILT app with the REAL API and a disposable LAB PostgreSQL
 * (started by e2e-r46/finish/run-lab.mjs):
 *  - without a session the page sends to the administrator sign-in and the API refuses (401); a session without MFA is refused (403);
 *  - policy pending (the honest default): six languages (ar right to left), desktop and a 375 px phone — translated title and menu entry, POLICY_PENDING stated,
 *    the two waiting links listed (identifier and date only), the e-mail-only link absent, no record form, no sideways scroll, axe WCAG 2.1 A/AA
 *    serious+critical = 0; a record through the API answers 409 POLICY_PENDING and changes nothing in the database;
 *  - synthetic configured policy: an empty submission gives a focused error summary linked to each field (axe clean in that state, fr desktop and ar 375 px);
 *    a valid record turns the link VERIFIED_STRONG in PostgreSQL, writes the AuditLog row with the reason and the consent-ledger row, and leaves the list.
 * Env (set by run-lab.mjs): R46F_BASE, R46F_BASE_CONF, R46F_TOKEN, R46F_TOKEN_NOMFA, R46F_LINKS, R46F_DB — never printed.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';

const BASE = process.env.R46F_BASE || 'http://127.0.0.1:5187';
const CONF = process.env.R46F_BASE_CONF || 'http://127.0.0.1:3187';
const TOKEN = process.env.R46F_TOKEN || '';
const NO_MFA = process.env.R46F_TOKEN_NOMFA || '';
const LINKS = JSON.parse(process.env.R46F_LINKS || '{}');
const PAGE = '/admin/representants-legaux';
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
const T = {
  title: { fr: 'Représentants légaux : vérification renforcée', en: 'Legal guardians: strong verification', tr: 'Yasal temsilciler: güçlendirilmiş doğrulama', ar: 'الممثلون القانونيون: التحقق المعزّز', de: 'Gesetzliche Vertreter: verstärkte Prüfung', uk: 'Законні представники: посилена перевірка' },
  nav: { fr: 'Représentants légaux (vérification)', en: 'Legal guardians (verification)', tr: 'Yasal temsilciler (doğrulama)', ar: 'الممثلون القانونيون (التحقق)', de: 'Gesetzliche Vertreter (Prüfung)', uk: 'Законні представники (перевірка)' },
  pending: { fr: 'Pas encore fixée', en: 'Not set yet', tr: 'Henüz belirlenmedi', ar: 'لم تُحدَّد بعد', de: 'Noch nicht festgelegt', uk: 'Ще не визначена' },
};
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const ctx = async (browser, lang, { mobile = false, token = TOKEN } = {}) => {
  const context = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  await context.addInitScript(([l, tok]) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); if (tok) sessionStorage.setItem('access_token', tok); } catch { /* storage refused */ } }, [lang, token]);
  return context;
};
const api = (request, base, token, body) => request.post(`${base}/api/admin/guardianships`, { data: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const db = async (fn) => { const c = new pg.Client({ connectionString: process.env.R46F_DB }); await c.connect(); try { return await fn(c); } finally { await c.end(); } };
const statusOf = (id) => db(async (c) => (await c.query('SELECT status FROM "GuardianRelationship" WHERE id = $1', [id])).rows[0]?.status);

test.beforeAll(() => { expect(TOKEN, 'R46F_TOKEN').not.toBe(''); expect(LINKS.strong1, 'R46F_LINKS').toBeTruthy(); });

test('without a session the page sends to the sign-in; the API refuses without CSRF token (403), without a session (401) and without MFA (403)', async ({ browser, request }) => {
  const context = await ctx(browser, 'fr', { token: '' }); const page = await context.newPage();
  await page.goto(`${BASE}${PAGE}`);
  await expect(page).toHaveURL(/\/admin\/login$/);
  // an anonymous POST without the double-submit token stops at the CSRF check (403); with it, the gate answers 401 (no session)
  expect((await api(request, BASE, '', { action: 'list' })).status()).toBe(403);
  await context.request.get(`${BASE}/api/health`);
  const csrf = (await context.cookies()).find((c) => c.name === '__csrf');
  expect(csrf, 'the __csrf cookie set by a GET').toBeTruthy();
  expect((await context.request.post(`${BASE}/api/admin/guardianships`, { data: { action: 'list' }, headers: { 'x-csrf-token': csrf.value } })).status()).toBe(401);
  await context.close();
  const r = await api(request, BASE, NO_MFA, { action: 'list' });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toBe('HUMAN_MFA_SESSION_REQUIRED');
});

for (const mobile of [false, true]) {
  for (const lang of LANGS) {
    if (mobile && !['fr', 'ar'].includes(lang)) continue;
    test(`${lang} ${mobile ? 'mobile 375' : 'desktop'}: policy pending is stated, the waiting links are listed, no record form`, async ({ browser }) => {
      const context = await ctx(browser, lang, { mobile }); const page = await context.newPage();
      await page.goto(`${BASE}${PAGE}`);
      await expect(page.getByRole('heading', { level: 1, name: T.title[lang] })).toBeVisible({ timeout: 30000 });
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      if (!mobile) await expect(page.getByRole('link', { name: T.nav[lang] })).toBeVisible();
      const policy = page.getByTestId('admin-guardians-policy');
      await expect(policy).toHaveAttribute('data-state', 'POLICY_PENDING');
      await expect(policy).toContainText(T.pending[lang]);
      const list = page.getByTestId('admin-guardians-list');
      await expect(list).toContainText(LINKS.strong1);
      await expect(list).toContainText(LINKS.strong2);
      await expect(list).not.toContainText(LINKS.emailOnly);
      await expect(page.getByTestId('admin-guardians-form')).toHaveCount(0);
      const html = await page.content();
      expect(html).not.toMatch(/r46f-[gm]\d-[a-z0-9]+@example\.test/);   // no e-mail of either person (the signed-in administrator's own address is in the menu)
      expect(await overflow(page), 'no sideways scroll').toBeLessThanOrEqual(0);
      await axeSerious(page, `${lang} ${mobile ? 'mobile' : 'desktop'} pending`);
      await context.close();
    });
  }
}

test('policy pending: a record through the API is refused (409 POLICY_PENDING) and nothing changes', async ({ request }) => {
  const r = await api(request, BASE, TOKEN, { action: 'record', id: LINKS.strong2, method: 'PROFESSIONAL_ATTESTATION', reason: 'Attestation synthétique vue en LAB' });
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toBe('POLICY_PENDING');
  expect(await statusOf(LINKS.strong2)).toBe('STRONGER_VERIFICATION_REQUIRED');
  const short = await api(request, BASE, TOKEN, { action: 'record', id: LINKS.strong2, method: 'PROFESSIONAL_ATTESTATION', reason: 'court' });
  expect(short.status()).toBe(400);
  expect((await short.json()).error).toBe('reason_required');
});

for (const [lang, mobile] of [['fr', false], ['ar', true]]) {
  test(`${lang} ${mobile ? 'mobile 375' : 'desktop'} configured policy: an empty submission shows a focused, linked error summary (axe clean)`, async ({ browser }) => {
    const context = await ctx(browser, lang, { mobile }); const page = await context.newPage();
    await page.goto(`${CONF}${PAGE}`);
    await expect(page.getByRole('heading', { level: 1, name: T.title[lang] })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('admin-guardians-policy')).toHaveAttribute('data-state', 'CONFIGURED');
    await page.getByTestId('admin-guardians-submit').click();
    const summary = page.getByTestId('admin-guardians-summary');
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveCount(3);
    for (const field of await page.locator('[aria-invalid="true"]').all()) {
      const ids = (await field.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      expect(ids.length, 'each invalid field names its error').toBeGreaterThan(0);
      for (const id of ids) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
    await summary.getByRole('link').last().click();
    await expect(page.locator('textarea')).toBeFocused();
    expect(await overflow(page), 'no sideways scroll').toBeLessThanOrEqual(0);
    await axeSerious(page, `${lang} configured errors`);
    await context.close();
  });
}

test('configured policy: recording the strong check verifies the link in PostgreSQL, with the AuditLog reason and the consent ledger', async ({ browser }) => {
  const context = await ctx(browser, 'fr'); const page = await context.newPage();
  await page.goto(`${CONF}${PAGE}`);
  await expect(page.getByTestId('admin-guardians-form')).toBeVisible({ timeout: 30000 });
  await page.getByLabel(new RegExp(`Lien ${LINKS.strong1}`)).check();
  await page.getByLabel(/Méthode utilisée/).selectOption('PROFESSIONAL_ATTESTATION');
  const reason = 'Attestation synthétique d’un professionnel, vue en LAB R46';
  await page.getByLabel(/Motif : comment/).fill(reason);
  await page.getByTestId('admin-guardians-submit').click();
  await expect(page.getByTestId('admin-guardians-done')).toContainText('Vérification renforcée enregistrée');
  await expect(page.getByLabel(new RegExp(`Lien ${LINKS.strong1}`))).toHaveCount(0);
  await expect(page.getByLabel(new RegExp(`Lien ${LINKS.strong2}`))).toBeVisible();
  expect(await statusOf(LINKS.strong1)).toBe('VERIFIED_STRONG');
  const rows = await db(async (c) => ({
    audit: (await c.query(`SELECT actor, details FROM "AuditLog" WHERE action = 'guardian.strong_verification_recorded' AND entity_id = $1`, [LINKS.strong1])).rows,
    scopes: (await c.query('SELECT scopes FROM "GuardianRelationship" WHERE id = $1', [LINKS.strong1])).rows[0].scopes,
    consent: (await c.query(`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose = 'GUARDIAN_LINK_VERIFIED_STRONG:PROFESSIONAL_ATTESTATION' AND guardian_involved = true AND subject_id IN (SELECT "minorId" FROM "GuardianRelationship" WHERE id = $1)`, [LINKS.strong1])).rows[0].n,
  }));
  expect(rows.audit).toHaveLength(1);
  expect(rows.audit[0].actor).toBe('r46f-admin@example.test');
  expect(rows.audit[0].details).toEqual({ method: 'PROFESSIONAL_ATTESTATION', reason });
  expect(rows.scopes).toEqual(['synthetic.lab.scope']);
  expect(rows.consent).toBe(1);
  // a second record of the same link is refused (the state machine moved on), in the page language
  const again = await api(page.request, CONF, TOKEN, { action: 'record', id: LINKS.strong1, method: 'PROFESSIONAL_ATTESTATION', reason });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toBe('INVALID_STATE');
  await context.close();
});
