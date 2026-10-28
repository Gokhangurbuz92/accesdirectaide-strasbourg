import { test, expect } from './fixtures.js';

/**
 * CRITICAL SMOKE TEST - Quality Gate
 * 
 * This test ensures the application doesn't ship with:
 * - White screen (runtime errors)
 * - Console errors (React/undefined errors)
 * - Broken routing (404s on valid routes)
 * 
 * This is the MINIMUM quality gate for production deployments.
 */

test.describe('Critical Smoke Tests - Quality Gate', () => {
  
  test('Home page loads without errors', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    
    // Verify page is not blank
    await expect(page.locator('header, nav, h1, [role="banner"]').first()).toBeVisible({
      timeout: 10000
    });
    
    // Verify no page errors
    expect(pageErrors, `Page errors: ${pageErrors.join(', ')}`).toHaveLength(0);
    
    // Verify no critical console errors
    const criticalErrors = consoleErrors.filter(err => 
      err.includes('undefined') || 
      err.includes('useLayoutEffect') ||
      err.includes('useMergeRef') ||
      err.includes('Cannot read properties')
    );
    expect(criticalErrors, `Console errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('Aides list page loads', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/aides');
    
    // Verify page renders
    await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    
    // Verify no errors
    expect(pageErrors).toHaveLength(0);
  });

  test('Demarches list page loads', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/demarches');
    
    // Verify page renders
    await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    
    // Verify no errors
    expect(pageErrors).toHaveLength(0);
  });

  test('Structures list page loads', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/structures');
    
    // Verify page renders
    await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    
    // Verify no errors
    expect(pageErrors).toHaveLength(0);
  });

  test('Direct URL access works (SPA routing)', async ({ page }) => {
    // Test that refreshing on a route doesn't 404
    await page.goto('/aides');
    await expect(page.locator('main').first()).toBeVisible();
    
    // Reload should work
    await page.reload();
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('404 page handles invalid routes gracefully', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/this-route-does-not-exist-12345');
    
    // Should show 404 page, not crash
    // Verify no runtime errors
    expect(pageErrors).toHaveLength(0);
  });

});
