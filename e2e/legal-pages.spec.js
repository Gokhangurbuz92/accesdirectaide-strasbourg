import { test, expect } from './fixtures.js';
import { setupPublicMocks } from './_mocks/publicApiMocks.js';

test.describe('P10-1 Legal / RGPD baseline', () => {
  test('footer exposes legal links', async ({ page }) => {
    await setupPublicMocks(page);
    await page.goto('/');

    const mentions = page.getByRole('link', { name: 'Mentions légales' }).first();
    const privacy = page.getByRole('link', { name: 'Politique de confidentialité' }).first();
    const cookies = page.getByRole('link', { name: 'Cookies' }).first();

    await expect(mentions).toBeVisible();
    await expect(privacy).toBeVisible();
    await expect(cookies).toBeVisible();

    await expect(mentions).toHaveAttribute('href', /\/mentions-legales$/);
    await expect(privacy).toHaveAttribute('href', /\/politique-confidentialite$/);
    await expect(cookies).toHaveAttribute('href', /\/cookies$/);
  });

  test('legal pages are publicly reachable and render content', async ({ page }) => {
    await setupPublicMocks(page);

    await page.goto('/mentions-legales');
    await expect(page.getByRole('heading', { level: 1, name: 'Mentions légales' })).toBeVisible();

    await page.goto('/politique-confidentialite');
    await expect(page.getByRole('heading', { level: 1, name: 'Politique de confidentialité' })).toBeVisible();

    await page.goto('/cookies');
    await expect(page.getByRole('heading', { level: 1, name: 'Cookies' })).toBeVisible();
  });

  test('legacy privacy route redirects to canonical path', async ({ page }) => {
    await setupPublicMocks(page);

    await page.goto('/confidentialite');
    await expect(page).toHaveURL(/\/politique-confidentialite$/);
  });
});
