import { test, expect } from '@playwright/test';

/**
 * Production Smoke Tests — vérifications rapides que les pages principales chargent.
 *
 * Usage :
 *   npm run dev          # Dans un premier terminal
 *   npx playwright test e2e/smoke-prod.spec.js  # Dans un second
 */
test.describe('Production Smoke Tests', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Accès Direct|Aide/i);
  });

  test('aides page loads', async ({ page }) => {
    await page.goto('/aides');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/aide/i);
  });

  test('structures page loads', async ({ page }) => {
    await page.goto('/annuaire');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/annuaire|structure/i);
  });

  test('confidentialite page loads', async ({ page }) => {
    await page.goto('/confidentialite');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/donn|cookie|confidential/i);
  });

  test('admin login page loads', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('input[type="email"], input[type="text"], input[name="email"]')
    ).toBeVisible({ timeout: 10000 });
  });

  // Note: API endpoint tests are in tests/integration/smoke-api.test.js (Vitest).
  // In CI, the Vite dev server returns HTML for /api/ routes, so we only test page navigation here.
  test('health page exists', async ({ page }) => {
    const res = await page.goto('/api/health');
    // In dev, returns SPA HTML (200). In prod, returns JSON (200). Both are OK.
    expect(res.status()).toBeLessThan(500);
  });
});
