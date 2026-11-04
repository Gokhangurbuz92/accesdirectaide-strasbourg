/**
 * R43-A11Y (A5) — field-level error semantics of the back-office and account forms on the BUILT app (R43_BASE, e.g. vite preview on :5183), in the six
 * languages (ar right-to-left): a refused submit focuses the error summary, each field in error is aria-invalid and described by its own message, nothing
 * is sent; axe WCAG 2.1 A/AA serious+critical = 0 on the page with the errors shown; no sideways scroll at 390 px.
 * The API is answered by route doubles (no server, no database, no mail): the rules themselves are enforced and tested on the server side.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.R43_BASE || 'http://127.0.0.1:5183';
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300); };
const axeSerious = async (page, sel = 'main') => (await settle(page), expect(await page.locator(sel).count(), `${sel} exists (axe would scan nothing)`).toBeGreaterThan(0), await new AxeBuilder({ page }).include(sel).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze())
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** the API doubles; every write is recorded so a test can assert that nothing was sent */
async function doubles(page, lang, extra = {}) {
  const writes = [];
  await page.addInitScript((l) => {
    try { localStorage.setItem('ada_lang', l); localStorage.setItem('pro_token', 'synthetic'); localStorage.setItem('ada_onboarding_done', '1'); sessionStorage.setItem('access_token', 'r43-synthetic-admin'); } catch { /* */ }
  }, lang);
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
    if (req.method() !== 'GET') writes.push(`${req.method()} ${p}`);
    for (const [prefix, answer] of Object.entries(extra)) if (p === prefix) return route.fulfill(json(typeof answer === 'function' ? answer(url, req) : answer));
    if (p === '/api/pro/me') return route.fulfill(json({ user: { id: 'u1', email: 'pro@example.test', role: 'STRUCTURE_ADMIN', mfa_enabled: true }, structure: { id: 's1', nom: 'Structure fictive' }, session: { mfa: true, mfaRequired: false } }));
    if (p === '/api/auth/me') return route.fulfill(json({ user: { id: 'r43-admin', role: 'admin' } }));
    if (p.startsWith('/api/pro/notifications')) return route.fulfill(json({ count: 0, notifications: [] }));
    return route.fulfill(json({}));
  });
  return writes;
}

/** after a refused submit: the summary has the focus and links to every field in error; each field is invalid and described by its message */
async function expectRefused(page, summaryTestId, fieldIds) {
  const summary = page.getByTestId(summaryTestId);
  await expect(summary).toBeFocused();
  await expect(summary).toHaveAttribute('role', 'alert');
  for (const id of fieldIds) {
    const field = page.locator(`[id="${id}"]`);
    await expect(field, id).toHaveAttribute('aria-invalid', 'true');
    await expect(field, id).toHaveAttribute('aria-describedby', new RegExp(`${id}-error`));
    await expect(page.locator(`[id="${id}-error"]`), `${id} message`).not.toBeEmpty();
    await expect(summary.locator(`a[href="#${id}"]`), `summary link to ${id}`).toHaveCount(1);
  }
}

test.describe.configure({ mode: 'serial' });

const CASE = { case: { id: 'c1', dossierId: 'd1234567890', status: 'OPEN', assignee: null }, members: [{ id: 'u1', email: 'pro@example.test' }], notes: [], events: [], canAssignOthers: true };

for (const lang of LANGS) {
  test(`pro dossier follow-up (${lang}): note, orientation and closure refuse an incomplete submit on the fields`, async ({ page }) => {
    const writes = await doubles(page, lang, { '/api/pro/cases': CASE, '/api/pro/referrals': { referrals: [] } });
    await page.goto(`${BASE}/pro/dossiers/c1`);
    await expect(page.getByTestId('pro-case-note-form')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    await page.getByTestId('pro-note-add').click();
    await expectRefused(page, 'pro-case-note-errors', ['case-note-body']);
    await page.getByTestId('pro-referral-propose').click();
    await expectRefused(page, 'pro-referral-errors', ['case-referral-search', 'case-referral-reason']);
    await page.getByTestId('pro-case-close').click();
    await expectRefused(page, 'pro-case-close-errors', ['case-close-outcome']);
    // a summary link moves the keyboard focus to its field
    await page.getByTestId('pro-case-close-errors').locator('a').first().click();
    await expect(page.locator('#case-close-outcome')).toBeFocused();
    expect(writes, 'nothing sent').toEqual([]);
    expect(await axeSerious(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflow(page), 'no sideways scroll at 390 px').toBeLessThanOrEqual(0);
  });

  test(`Ma structure and organisations (${lang}): proposal and activity reason are checked on the field`, async ({ page }) => {
    const writes = await doubles(page, lang, {
      '/api/pro/structure': { structure: null, proposals: [], canPropose: true, fields: ['horaires'] },
      '/api/admin/organizations': { organizations: [{ id: 'o1', nom: 'Organisation fictive', ville: 'Strasbourg', identity: 'VERIFIED', statut: 'actif', public: { visible: true, reasons: [] }, canReceiveNew: true, activeMembers: 1 }] },
    });
    await page.goto(`${BASE}/pro/structure`);
    await expect(page.getByTestId('structure-propose')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('structure-propose').click();
    await expectRefused(page, 'structure-propose-errors', ['structure-value']);
    await page.getByTestId('structure-closure-request').click();
    await expectRefused(page, 'structure-closure-errors', ['structure-closure-reason']);
    expect(await axeSerious(page)).toEqual([]);

    await page.goto(`${BASE}/admin/organizations`);
    await expect(page.getByTestId('admin-org')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('admin-org').locator('summary').click();
    await page.getByTestId('admin-org-suspend').click();
    await expectRefused(page, 'admin-org-errors-o1', ['why-o1']);
    expect(await axeSerious(page)).toEqual([]);
    expect(writes, 'nothing sent').toEqual([]);
  });

  test(`institutional sign-in (${lang}): empty fields are said on the fields`, async ({ page }) => {
    const writes = await doubles(page, lang);
    await page.goto(`${BASE}/institution`);
    await expect(page.locator('#inst-email')).toBeVisible({ timeout: 30000 });
    await page.locator('#inst-email').locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    await expectRefused(page, 'institution-login-errors', ['inst-email', 'inst-pass']);
    expect(writes, 'nothing sent').toEqual([]);
    expect(await axeSerious(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflow(page), 'no sideways scroll at 390 px').toBeLessThanOrEqual(0);
  });
}
