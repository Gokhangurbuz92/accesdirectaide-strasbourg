import { test, expect } from './fixtures.js';

test.describe('Ressources Module Navigation', () => {
    test.beforeEach(async ({ page }) => {
        // Mock API responses
        await page.route('**/api/ressources*', async route => {
            const url = route.request().url();

            if (url.includes('slug=') || url.includes('id=')) {
                // Detail response
                await route.fulfill({
                    json: {
                        id: 'test-ressource-1',
                        slug: 'test-ressource-slug',
                        title: 'Ressource Test E2E',
                        type: 'guide',
                        content: 'Contenu détaillé de la ressource de test',
                        source_url: 'https://example.com/source',
                        retrieved_at: new Date().toISOString(),
                        status: 'published'
                    }
                });
            } else {
                // List response
                await route.fulfill({
                    json: {
                        items: [
                            {
                                id: 'test-ressource-1',
                                slug: 'test-ressource-slug',
                                title: 'Ressource Test E2E',
                                type: 'guide',
                                content: 'Description courte ressource',
                                source_url: 'https://example.com/source',
                                status: 'published'
                            }
                        ],
                        pagination: {
                            total: 1,
                            page: 1,
                            pageSize: 12,
                            totalPages: 1
                        }
                    }
                });
            }
        });
    });

    test('should navigate from ressources list to detail page', async ({ page }) => {
        // Navigate to ressources listing
        await page.goto('/ressources');

        // Wait for page to load
        await page.waitForLoadState('networkidle');

        // Check title
        await expect(page).toHaveTitle(/ressources/i);

        // Find and click on first ressource card
        const card = page.getByTestId('ressource-card').first();
        await card.waitFor({ state: 'visible' });

        const cardTitle = await page.getByTestId('ressource-title').first().innerText();
        expect(cardTitle).toBeTruthy();

        await card.click();

        // Verify navigation to detail page
        await expect(page).toHaveURL(/\/ressources\/[\w-]+/);

        // Verify detail page content
        await expect(page.locator('h1')).toContainText(cardTitle);

        // Verify traceability section is visible
        await expect(page.getByText(/Source et traçabilité/i)).toBeVisible();
    });

    test('should display source traceability on detail page', async ({ page }) => {
        await page.goto('/ressources/test-ressource-slug');

        await page.waitForLoadState('networkidle');

        // Check for traceability section
        const traceabilitySection = page.locator('text=Source et traçabilité').locator('..');
        await expect(traceabilitySection).toBeVisible();

        // Check for source URL
        await expect(page.getByText(/example.com/)).toBeVisible();
    });

    test('should handle 404 for non-existent ressource', async ({ page }) => {
        // Mock 404 response
        await page.route('**/api/ressources*slug=non-existent*', async route => {
            await route.fulfill({
                status: 404,
                json: { error: 'Ressource non trouvée' }
            });
        });

        await page.goto('/ressources/non-existent');

        // Should show 404 or NotFound page
        await expect(page.locator('text=/404|introuvable|non trouvée|not found|erreur/i').first()).toBeVisible({ timeout: 10000 });
    });
});
