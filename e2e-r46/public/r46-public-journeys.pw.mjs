/**
 * R46 public worker — real-browser journeys on the LAB app with the REAL API router (e2e-r46/public/serve-lab.mjs; no mail provider configured):
 *   P07  /territoire « Trouver ma commune par code postal » in six languages (ar right to left), desktop and a 375 px phone: a code covering two communes
 *        lists both (never the first one only), a commune outside the Eurométropole is said to be outside, unknown / invalid codes are said, an outage is
 *        said with a working retry; QPV listed at commune level with the official address lookup; axe WCAG 2.1 A/AA serious+critical = 0; no sideways scroll.
 *   P20  /contact with no mail provider: the provider-status line is shown BEFORE anyone types; a sent message is answered 503 NOT_DELIVERED with
 *        reason MAIL_NOT_CONNECTED and the page says it was not transmitted; no success screen.
 *   BETA (server started with ADA_PUBLIC_BETA_RESTRICTED=1, run with R46_BETA=1): the postal lookup still answers (read-only official reference) and the
 *        contact page says BEFORE typing that the form sends nothing during the beta.
 * Env: R46_BASE (default http://127.0.0.1:5181), R46_BETA, R46_EVIDENCE (optional JSON evidence file).
 */
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.R46_BASE || 'http://127.0.0.1:5181';
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
const MULTIPLE = { fr: 'couvre plusieurs communes', en: 'covers several communes', tr: 'birden fazla belediyeyi kapsıyor', ar: 'عدة بلديات', de: 'umfasst mehrere Gemeinden', uk: 'охоплює кілька комун' };
const OUTSIDE = { fr: "n'est pas dans le territoire couvert", en: 'is not in the area covered', tr: 'kapsanan bölgede değil', ar: 'ليست ضمن المنطقة المشمولة', de: 'gehört vorerst nicht zum abgedeckten Gebiet', uk: 'поки що не входить до території' };
const BETA = process.env.R46_BETA === '1';
const evidence = [];
test.afterAll(() => { if (process.env.R46_EVIDENCE) fs.writeFileSync(process.env.R46_EVIDENCE, JSON.stringify(evidence, null, 2)); });

const prepare = (context, lang) => context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const lookup = async (page, code) => {
  const answer = page.waitForResponse((r) => r.url().includes('/api/territory/postal'));
  await page.getByTestId('territoire-postal-input').fill(code);
  await page.getByTestId('territoire-postal-submit').click();
  return answer;
};

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 375, height: 812 }]) {
  for (const lang of LANGS) {
    test(`P07 postal code → communes and QPV — ${lang} ${viewport.name}`, async ({ page, context }) => {
      test.skip(BETA, 'full journey on the non-beta server');
      await page.setViewportSize(viewport);
      await prepare(context, lang);
      await page.goto(`${BASE}/territoire`);
      const box = page.getByTestId('territoire-postal');
      await expect(box).toBeVisible({ timeout: 30000 });
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(lang === 'ar' ? 'rtl' : 'ltr');

      // two communes for one code: both listed, chosen by the person
      const r1 = await lookup(page, '67800');
      expect(r1.status()).toBe(200);
      const status = page.getByTestId('territoire-postal-status');
      await expect(status).toHaveAttribute('data-state', 'done');
      await expect(page.getByTestId('territoire-postal-summary')).toContainText(MULTIPLE[lang]);
      const items = page.getByTestId('territoire-postal-candidates').locator('li[data-commune]');
      await expect(items).toHaveCount(2);
      expect(await items.evaluateAll((els) => els.map((e) => [e.getAttribute('data-commune'), e.getAttribute('data-in-territory')]))).toEqual([['67043', 'yes'], ['67204', 'yes']]);
      await expect(items.first()).toContainText('Guirbaden');                      // official 2024 QPV of Bischheim
      await expect(items.first().locator('a[href="https://sig.ville.gouv.fr"]')).toHaveCount(1);
      await expect(page.getByTestId('territoire-postal-source')).toContainText('La Poste');
      await axeSerious(page, `territoire ${lang} ${viewport.name} multiple`);
      expect(await overflow(page), 'no sideways scroll').toBeLessThanOrEqual(0);

      // outside the Eurométropole
      await lookup(page, '68100');
      await expect(status).toHaveAttribute('data-state', 'done');
      await expect(page.getByTestId('territoire-postal-candidates')).toContainText(OUTSIDE[lang]);
      expect(await page.getByTestId('territoire-postal-candidates').locator('li[data-in-territory="yes"]').count()).toBe(0);

      // unknown and invalid
      await lookup(page, '00000');
      await expect(status).toHaveAttribute('data-state', 'unknown');
      await page.getByTestId('territoire-postal-input').fill('6710');
      await page.getByTestId('territoire-postal-submit').click();
      await expect(status).toHaveAttribute('data-state', 'invalid');
      await expect(page.getByTestId('territoire-postal-input')).toHaveAttribute('aria-invalid', 'true');

      // outage → said, retry works
      await page.route('**/api/territory/postal**', (rt) => rt.abort('failed'));
      await page.getByTestId('territoire-postal-input').fill('67000');
      await page.getByTestId('territoire-postal-submit').click();
      await expect(status).toHaveAttribute('data-state', 'error');
      await page.unroute('**/api/territory/postal**');
      const retried = page.waitForResponse((r) => r.url().includes('/api/territory/postal'));
      await page.getByTestId('territoire-postal-retry').click();
      expect((await retried).status()).toBe(200);
      await expect(status).toHaveAttribute('data-state', 'done');
      await expect(page.getByTestId('territoire-postal-candidates').locator('li[data-commune="67482"]')).toHaveCount(1);
      await axeSerious(page, `territoire ${lang} ${viewport.name} single`);
      evidence.push({ test: 'P07', lang, viewport: viewport.name, ok: true });
    });
  }
}

test('P20 contact with no mail provider: status line before typing, honest 503, no success screen', async ({ page, context }) => {
  test.skip(BETA, 'non-beta server');
  await prepare(context, 'fr');
  const status = page.waitForResponse((r) => r.url().endsWith('/api/contact') && r.request().method() === 'GET');
  await page.goto(`${BASE}/contact?sujet=question`);
  const s = await status;
  expect(await s.json()).toEqual({ channel: 'NOT_CONNECTED', directAddress: 'contact@accesdirectaide.fr' });
  const line = page.getByTestId('contact-channel-status');
  await expect(line).toBeVisible({ timeout: 30000 });
  await expect(line).toHaveAttribute('data-channel', 'NOT_CONNECTED');
  await expect(line).toContainText("n'est pas encore en service");
  await page.getByLabel('Votre email *').fill('r46-public@example.test');
  await page.getByLabel('Votre message *').fill('Message synthétique R46.');
  const post = page.waitForResponse((r) => r.url().endsWith('/api/contact') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Envoyer mon message' }).click();
  const r = await post;
  expect(r.status()).toBe(503);
  expect(await r.json()).toMatchObject({ delivered: false, code: 'NOT_DELIVERED', reason: 'MAIL_NOT_CONNECTED' });
  await expect(page.getByTestId('contact-error')).toContainText("n'a pas pu être transmis", { timeout: 15000 });
  await expect(page.getByTestId('contact-sent')).toHaveCount(0);
  await axeSerious(page, 'contact not connected');
  evidence.push({ test: 'P20', ok: true });
});

test('BETA: postal lookup answers, contact says the form sends nothing during the beta', async ({ page, context }) => {
  test.skip(!BETA, 'beta server only');
  await prepare(context, 'fr');
  await page.goto(`${BASE}/territoire`);
  await expect(page.getByTestId('territoire-postal')).toBeVisible({ timeout: 30000 });
  const r = await lookup(page, '67100');
  expect(r.status()).toBe(200);
  await expect(page.getByTestId('territoire-postal-status')).toHaveAttribute('data-state', 'done');
  const status = page.waitForResponse((x) => x.url().endsWith('/api/contact') && x.request().method() === 'GET');
  await page.goto(`${BASE}/contact`);
  expect((await status).status()).toBe(503);
  const line = page.getByTestId('contact-channel-status');
  await expect(line).toHaveAttribute('data-channel', 'CLOSED', { timeout: 30000 });
  await expect(line).toContainText('Pendant la bêta publique');
  await axeSerious(page, 'contact beta');
  evidence.push({ test: 'BETA', ok: true });
});
