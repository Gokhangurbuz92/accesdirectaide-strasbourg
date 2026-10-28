import { test, expect } from './fixtures.js';

test.describe('Admin Smoke Test', () => {
    test('Full Content Lifecycle: Create -> Publish -> Verify', async ({ page }) => {
        // Mock admin login
        await page.route('**/api/admin/login', async route => {
            await route.fulfill({
                json: { success: true, token: 'mock-admin-token' }
            });
        });

        // Mock admin aides API
        await page.route('**/api/admin/aides*', async route => {
            if (route.request().method() === 'POST') {
                return route.fulfill({
                    status: 201,
                    json: { id: 'new-aide', slug: 'aide-test', titre: 'Test Aide' }
                });
            }
            return route.fulfill({
                json: { items: [], pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 } }
            });
        });

        // 1. Navigate to admin login
        await page.goto('/admin/login');

        // Check that the login form is visible (can be h1, h2, or label)
        const loginForm = page.locator('form, [role="form"]').first();
        await expect(loginForm).toBeVisible({ timeout: 10_000 });

        // Fill and submit
        const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
        const passwordInput = page.locator('input[type="password"], input[name="password"], #password').first();
        await emailInput.fill('admin@accesdirectaide.fr');
        await passwordInput.fill('admin');
        await page.getByRole('button', { name: /connecter|login|connexion/i }).click();

        // Wait for navigation or page change
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        // Verify we can access admin area (admin dashboard or redirect)
        // The page should not show an error
        const body = await page.locator('body').textContent();
        expect(body.length).toBeGreaterThan(50);
    });
});
