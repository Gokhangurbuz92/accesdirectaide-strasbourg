
import { test, expect } from './fixtures.js';

test.describe('Aides Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Mock Taxonomy
        await page.route('**/api/taxonomy', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ categories: [{ slug: 'logement', label: 'Logement' }], situations: [] })
            });
        });
    });

    test('should display filters and navigate to detail', async ({ page }) => {
        // 1. Mock Listing
        await page.route('**/api/aides*', async route => {
            const url = new URL(route.request().url());
            if (url.pathname.includes('/api/aides/')) {
                // Detail Mock (path-based: /api/aides/aide-test)
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        id: '123',
                        slug: 'aide-test',
                        titre: 'Aide Test',
                        categorie: 'logement',
                        cest_quoi: 'Description longue',
                        source_url: 'https://source.com',
                        apply_url: 'https://apply.com',
                        fetched_at: new Date().toISOString()
                    })
                });
                return;
            }

            // Listing Mock
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: [
                        { id: '123', slug: 'aide-test', titre: 'Aide Test', categorie: 'logement', summary_falc: 'Résumé' }
                    ],
                    facets: {
                        themes: { logement: 1 },
                        territoires: { national: 1 }
                    },
                    pagination: { page: 1, totalPages: 1, total: 1 }
                })
            });
        });

        // Sidebar query from AideDetail
        await page.route('**/api/structures*', async route => {
            await route.fulfill({ json: { items: [] } });
        });

        // 2. Visit Page
        await page.goto('/aides');
        await expect(page.getByRole('heading', { level: 1, name: 'Aides' })).toBeVisible();

        // 3. Choose a category. 11/11/2026 redesign: the categories are chips above the results (the old « Filtres » panel and its #aides-category
        //    select are gone; the sidebar keeps situation / territory / urgency) — the same API filter, the same URL contract
        const chips = page.getByTestId('aides-category-chips');
        await expect(chips).toBeVisible();
        await chips.getByRole('button', { name: 'Logement', exact: true }).click();
        await expect(chips.getByRole('button', { name: 'Logement', exact: true })).toHaveAttribute('aria-pressed', 'true');

        await expect(page).toHaveURL(/category=logement/);

        // 4. Click Card Link
        await page.getByTestId('aide-card-link').first().click();
        await expect(page).toHaveURL(/\/aides\/aide-test/);

        // 5. Verify Detail
        await expect(page.locator('h1')).toBeVisible();
    });
});
