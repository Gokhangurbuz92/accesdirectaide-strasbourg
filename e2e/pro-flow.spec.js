import { test, expect } from './fixtures.js';
import { setupPublicMocks } from './_mocks/publicApiMocks.js';

test.describe('E2E Pro Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Mock all public APIs heavily used by Layout
        await setupPublicMocks(page);

        // Mock authentication check
        await page.route('**/api/pro/me*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: { kind: 'pro', authType: 'pro_cookie', role: 'pro' },
                    user: { id: 'pro-1', role: 'pro', email: 'pro@test.local', structureId: 'struct-1' },
                }),
            });
        });

        // Mock login
        await page.route('**/api/pro/auth/login', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    token: 'mock-pro-token',
                    session: { kind: 'pro', authType: 'pro_cookie', role: 'pro' },
                    user: { id: 'pro-1', role: 'pro', email: 'pro@test.local' },
                    mfa_required: false
                }),
            });
        });

        // Mock Team data
        await page.route('**/api/pro/team*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    users: [
                        { id: 'pro-1', email: 'pro@test.local', role: 'admin', status: 'active' }
                    ]
                }),
            });
        });

        // Mock RDV data
        await page.route('**/api/pro/appointments*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: []
                }),
            });
        });

        // Mock Messages data
        await page.route('**/api/pro/messages*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    conversations: []
                }),
            });
        });
    });

    test('login -> dashboard -> RDV -> messages', async ({ page }) => {
        // 1. Go to Pro Login
        await page.goto('/pro/login');
        await expect(page).toHaveURL(/\/pro\/login/);

        // Wait for the login form
        await expect(page.locator('input[type="email"]')).toBeVisible();

        // Fill credentials
        await page.locator('input[type="email"]').fill('pro@test.local');
        await page.locator('input[type="password"]').fill('password123');

        // Click Login
        await Promise.all([
            page.waitForRequest((request) => request.url().includes('/api/pro/auth/login') && request.method() === 'POST'),
            page.locator('button[type="submit"]').click(),
        ]);

        // 2. Should redirect to Dashboard
        // 2. Wait for redirect to Dashboard, bypassing the loading state or Layout headers
        await page.waitForURL('**/pro/dashboard*');
        // Wait for dashboard to load (checking the main layout heading instead of the brand h1)
        await expect(page.getByRole('heading', { name: /Tableau de Bord/i, level: 1 })).toBeVisible({ timeout: 10000 });

        // 3. Navigate to RDV
        // Try clicking navigation link if it exists, otherwise goto directly
        const rdvLink = page.locator('nav').getByRole('link', { name: /Rendez-vous|Agenda/i });
        if (await rdvLink.count() > 0) {
            await rdvLink.first().click();
        } else {
            await page.goto('/pro/rdv/agenda');
        }
        await expect(page).toHaveURL(/.*\/pro\/rdv/);
        await expect(page.getByRole('heading', { name: /Agenda|Rendez-vous/i }).first()).toBeVisible();

        // 4. Navigate to Messages
        const msgLink = page.locator('nav').getByRole('link', { name: /Messages/i });
        if (await msgLink.count() > 0) {
            await msgLink.first().click();
        } else {
            await page.goto('/pro/messages');
        }
        await expect(page).toHaveURL(/.*\/pro\/messages/);
        await expect(page.getByRole('heading', { name: /Messages|Messagerie/i }).first()).toBeVisible();
    });
});
