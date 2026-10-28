
import { test, expect } from './fixtures.js';

test('CP1 Debug: Mocked Data Navigation', async ({ page }) => {
    // Mock the API response
    await page.route('*/**/api/aides*', async route => {
        const json = {
            items: [
                {
                    id: 'test-aide-1',
                    slug: 'aide-test-mock',
                    titre: 'Aide Test Mock',
                    categorie: 'logement',
                    est_urgent: false,
                    territoires: ['national'],
                    cest_quoi: 'Une aide de test pour verifier le clic.',
                    date_verification: '2023-01-01T00:00:00.000Z',
                    sources: []
                }
            ],
            pagination: { page: 1, totalPages: 1, total: 1 }
        };
        await route.fulfill({ json });
    });

    // Mock Taxonomy
    await page.route('*/**/api/taxonomy', async route => {
        await route.fulfill({ json: { categories: [], situations: [] } });
    });

    // Go to listing
    await page.goto('/aides');

    // Wait for card
    const card = page.getByTestId('aide-card');
    await expect(card).toBeVisible();

    // Inspect the link
    const link = page.getByTestId('aide-card-link').first();
    await expect(link).toBeVisible();

    // Check href
    const href = await link.getAttribute('href');
    console.log('Link href:', href);
    expect(href).toBe('/aides/aide-test-mock');

    // Click it
    await link.click();

    // Verify navigation
    await expect(page).toHaveURL(/\/aides\/aide-test-mock/);

});
