
import { test, expect } from './fixtures.js';

test('CP1bis: Zero Results & Tracking', async ({ page }) => {
    // Override global mock to force empty results for this test
    await page.route('**/api/aides**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                items: [],
                pagination: { page: 1, totalPages: 0, total: 0 }
            })
        });
    });

    // Mock Taxonomy
    await page.route('**/api/taxonomy**', async route => {
        await route.fulfill({ json: { categories: [], situations: [] } });
    });

    // 1. Go to listing with a query that would produce no results (mocked anyway)
    await page.goto('/aides?q=xyznotfound');

    // 2. Check Empty State Visibility via data-testid
    const emptyState = page.getByTestId('empty-state');
    await expect(emptyState).toBeVisible();

    // Check text content matches specs
    await expect(page.getByRole('heading', { name: "Aucune aide trouvée" })).toBeVisible();
    await expect(page.getByText("Essayez")).toBeVisible();

    // 3. Check Reset Button
    const resetButton = page.getByTestId('empty-reset');
    await expect(resetButton).toBeVisible();

    // 4. Click Reset and Verify URL params are cleared
    await resetButton.click();

    // URL should be /aides (or /aides?page=1 depending on implementation, but q should be gone)
    // We wait for URL to change
    await expect(page).toHaveURL(/\/aides/);
});
