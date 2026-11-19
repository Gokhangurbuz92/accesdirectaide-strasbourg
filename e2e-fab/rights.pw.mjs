/**
 * G3 (19/11/2026) — the public rights view /droits on the PRODUCTION configuration server (restricted beta, only « admin » open): reachable from /outils,
 * not behind the beta notice, keyboard-usable, no horizontal scroll at 320 px (French and Arabic right-to-left), and the page sends nothing of its own:
 * no request other than GET, and none that names a need. The data is static (data/reference/rights-public-view.v1.json); no API is mocked.
 */
import { test, expect } from '@playwright/test';
import { PROD, closeDb, visitor, ips } from './lib.mjs';

const nextIp = ips(60, 79);
test.afterAll(async () => { await closeDb(); });

/** an anonymous visitor on the Production configuration, with every request of the page recorded */
async function open(browser, opts = {}) {
  const P = await visitor(browser, nextIp, { base: PROD, ...opts });
  const page = await P.context.newPage();
  const requests = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname === '127.0.0.1') requests.push({ method: r.method(), path: `${u.pathname}${u.search}` }); });
  return { P, page, requests };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('G3-R1 /outils leads to /droits; the list of needs is open in the beta and usable with the keyboard; nothing but GET is sent', async ({ browser }) => {
  const { P, page, requests } = await open(browser);
  await page.goto(`${PROD}/outils`);
  await page.getByTestId('tools-rights-link').click();
  await page.waitForURL(/\/droits$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Explorer les droits par besoin' })).toBeVisible();
  await expect(page.getByTestId('public-beta-unavailable')).toHaveCount(0);
  const needs = page.getByTestId('rights-needs').getByRole('link');
  await expect(needs).toHaveCount(22);
  // keyboard: focus the first need and open it with Enter
  await needs.first().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/droits\/crise-suicide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Détresse, idées suicidaires' })).toBeVisible();
  await expect(page.getByTestId('rights-need-crise-suicide').getByRole('link', { name: '3114', exact: true })).toBeVisible();
  // a deep link answers directly (SPA route served by the server) with its fiches, bodies and next actions
  await page.goto(`${PROD}/droits/surendettement`);
  await expect(page.getByTestId('rights-fiche-F134')).toBeVisible();
  await expect(page.getByTestId('rights-aids').locator('[data-territory="alsace-moselle"]')).toContainText('Faillite civile');
  await expect(page.getByTestId('public-beta-unavailable')).toHaveCount(0);
  expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
  expect(requests.filter((r) => r.path.startsWith('/api/') && /droits|surendettement|crise-suicide/.test(r.path))).toEqual([]);
  expect(P.serverErrors).toEqual([]);
  await P.context.close();
});

test('G3-R2 320 px wide, French and Arabic (right to left): no horizontal scroll on the list and on a need', async ({ browser }) => {
  for (const lang of ['fr', 'ar']) {
    const { P, page } = await open(browser, { lang, viewport: { width: 320, height: 720 } });
    for (const p of ['/droits', '/droits/adaptation-logement', '/droits/surendettement']) {
      await page.goto(`${PROD}${p}`);
      await expect(page.locator('main h1, h1').first()).toBeVisible();
      if (lang === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      expect(await overflow(page), `${lang} ${p}`).toBeLessThanOrEqual(1);
    }
    expect(P.serverErrors).toEqual([]);
    await P.context.close();
  }
});
