import { test, expect } from './fixtures.js';

/**
 * LOT HOTFIX: SPA Routing Smoke Test
 * Verifies that all public routes load correctly with direct access (no white screen)
 * Tests critical user journeys and filters
 */

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4173';

test.describe('SPA Routing - Public Routes', () => {
  test('should load home page (/) without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text());
      }
    });

    await page.goto(`/`);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    expect(errors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('undefined') ||
      e.includes('Cannot read')
    )).toHaveLength(0);
  });

  test('should load /home route without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text());
      }
    });

    await page.goto(`/home`);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    expect(errors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('undefined') ||
      e.includes('Cannot read')
    )).toHaveLength(0);
  });

  test('should load /actualites route without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text());
      }
    });

    await page.goto(`/actualites`);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    expect(errors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('undefined') ||
      e.includes('Cannot read')
    )).toHaveLength(0);
  });

  test('should load /aides route without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`/aides`);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    expect(errors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('undefined')
    )).toHaveLength(0);
  });

  test('should load /structures (annuaire) route without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`/structures`);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    expect(errors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('undefined')
    )).toHaveLength(0);
  });

  test('should load /demarches route without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`/demarches`);
    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    expect(errors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('undefined')
    )).toHaveLength(0);
  });
});

test.describe('SPA Routing - Navigation & Filters', () => {
  test('should navigate between routes without errors', async ({ page }) => {
    await page.goto(`/`);
    await expect(page.locator('header')).toBeVisible();

    // Navigate to actualites
    await page.goto(`/actualites`);
    await expect(page.locator('header')).toBeVisible();

    // Navigate to aides
    await page.goto(`/aides`);
    await expect(page.locator('header')).toBeVisible();

    // Navigate back to home
    await page.goto(`/`);
    await expect(page.locator('header')).toBeVisible();
  });

  test('should handle direct access to /home (refresh scenario)', async ({ page }) => {
    // Simulate direct access / refresh
    await page.goto(`/home`);
    await page.reload();

    await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });

    // Verify page is not blank
    const bodyText = await page.locator('body').textContent();
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('should handle 404 routes gracefully', async ({ page }) => {
    await page.goto(`/route-qui-nexiste-pas-du-tout`);
    await page.waitForLoadState('domcontentloaded');

    // Should show 404 page, not white screen
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText.length).toBeGreaterThan(20);
  });
});

test.describe('SPA Routing - Assets & Resources', () => {
  test('should load all critical assets on /home', async ({ page }) => {
    const failedResources = [];

    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('/assets/')) {
        failedResources.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto(`/home`);
    await page.waitForLoadState('networkidle');

    expect(failedResources).toHaveLength(0);
  });

  test('should load JavaScript bundles correctly', async ({ page }) => {
    const jsErrors = [];

    page.on('pageerror', err => jsErrors.push(err.message));

    await page.goto(`/`);
    await page.waitForLoadState('networkidle');

    // No critical JS errors (React undefined, useLayoutEffect, etc.)
    const criticalErrors = jsErrors.filter(e =>
      e.includes('useLayoutEffect') ||
      e.includes('Cannot read properties of undefined') ||
      e.includes('React') && e.includes('undefined')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});
