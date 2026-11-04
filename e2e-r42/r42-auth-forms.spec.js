/**
 * R42-AUTH — the citizen sign-up form (adult declaration, minors' information, A5 error summary) and the professional MFA screen (invitation required),
 * on the BUILT app (R42_BASE, e.g. vite preview on :5185), in the six languages (ar right-to-left), axe WCAG 2.1 A/AA serious+critical = 0.
 * The API is answered by route doubles (no server, no mail): the server rules themselves are proven by tests/integration/r42-auth-accounts-mfa-db.test.js.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.R42_BASE || 'http://127.0.0.1:5185';
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
// fade-in / language-switch transitions finish before axe measures contrast (as the QA harness's fadeSettled)
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300); };
const axeSerious = async (page, sel) => (await settle(page), await new AxeBuilder({ page }).include(sel).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze())
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);

test.describe.configure({ mode: 'serial' });

for (const lang of LANGS) {
  test(`sign-up form (${lang}): adult declaration, minors' help, error summary takes the focus, axe clean`, async ({ page }) => {
    await page.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); } catch { /* */ } }, lang);
    let posted = null;
    await page.route('**/api/auth/signup', async (route) => { posted = route.request().postDataJSON(); await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'ADULT_DECLARATION_REQUIRED', code: 'ADULT_DECLARATION_REQUIRED', message: 'x' }) }); });
    await page.goto(`${BASE}/auth/signup`);
    await expect(page.locator('#auth-adult')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(await page.locator('#auth-adult').isChecked(), 'never pre-ticked').toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'no horizontal overflow (RTL included)').toBeLessThanOrEqual(0);
    const info = page.getByTestId('auth-minors-info');
    await expect(info.locator('a[href="tel:119"]')).toBeVisible(); await expect(info.locator('a[href="tel:112"]')).toBeVisible();
    await expect(info.locator('a[href="/besoins"]')).toBeVisible();
    expect(await axeSerious(page, 'main')).toEqual([]);

    // client check: no declaration → the summary takes the focus, the checkbox is marked invalid and described by its error; nothing is sent
    await page.locator('#auth-email').fill('r42-ui@example.test');
    await page.locator('#auth-password').fill('Synthetique-R42-pass1'); await page.locator('#auth-password-confirm').fill('Synthetique-R42-pass2');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByTestId('auth-error-summary')).toBeFocused();
    await expect(page.locator('#auth-adult')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#auth-adult')).toHaveAttribute('aria-describedby', /auth-adult-error/);
    await expect(page.locator('#auth-password-confirm')).toHaveAttribute('aria-invalid', 'true');
    expect(await page.getByTestId('auth-error-summary').locator('li a').count(), 'one entry per field').toBe(2);
    expect(posted).toBeNull();
    expect(await axeSerious(page, 'main')).toEqual([]);

    // the server refusal (direct rule) is shown on the same field
    await page.locator('#auth-password-confirm').fill('Synthetique-R42-pass1');
    await page.locator('#auth-adult').check();
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByTestId('auth-error-summary')).toBeFocused();
    expect(posted).toMatchObject({ email: 'r42-ui@example.test', adultDeclaration: true, site_web: '' });
    await expect(page.locator('#auth-adult')).toHaveAttribute('aria-invalid', 'true');
    // the honeypot is out of reach (not focusable, hidden from assistive technology)
    await expect(page.locator('#auth-site-web')).toHaveAttribute('tabindex', '-1');
    await page.screenshot({ path: `${process.env.R42_SHOTS || '/tmp'}/signup-${lang}.png`, fullPage: true });
  });
}

for (const lang of ['fr', 'ar']) {
  test(`MFA screen (${lang}): without an invitation the set-up is not offered; with the e-mailed link the invitation is redeemed and removed from the address`, async ({ page }) => {
    await page.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('pro_token', 'synthetic'); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } }, lang);
    await page.route('**/api/pro/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'pro@example.test', role: 'PRO', mfa_enabled: false, structure: { nom: 'Org' } }, session: { mfa: false, mfaRequired: true } }) }));
    await page.route('**/api/pro/notifications/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' }));
    let redeemed = null;
    await page.route('**/api/pro/mfa-enrolment', async (route) => { redeemed = route.request().postDataJSON(); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, enrolmentToken: 'grant', expiresInSeconds: 1800 }) }); });
    await page.goto(`${BASE}/pro/mfa-settings`);
    await expect(page.getByTestId('mfa-invitation-required')).toBeVisible({ timeout: 30000 });
    expect(await axeSerious(page, 'body')).toEqual([]);
    await page.goto('about:blank');   // a hash-only change would not reload the page
    await page.goto(`${BASE}/pro/mfa-settings#invitation=abc123`);
    await expect(page.getByRole('button', { name: /MFA|المصادقة|2FA/ }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('mfa-invitation-required')).toHaveCount(0);
    expect(redeemed).toEqual({ token: 'abc123' });
    expect(new URL(page.url()).hash, 'the token is removed from the address bar').toBe('');
    expect(await axeSerious(page, 'body')).toEqual([]);
  });
}
