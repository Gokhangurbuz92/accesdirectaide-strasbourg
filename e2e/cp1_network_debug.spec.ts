
import { test, expect } from './fixtures.js';

test('CP1 Debug Network: Check API Connectivity', async ({ page }) => {
    // Listen to network requests
    page.on('response', response => {
        if (response.url().includes('/api/')) {
            console.log(`API Response: ${response.url()} -> ${response.status()}`);
        }
    });

    await page.goto('/aides');

    // Wait for API requests to complete
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Check if we have the empty state or skeleton
    const skeleton = page.locator('.animate-pulse').first();
    const emptyState = page.getByText('Aucune aide trouvée');
    const card = page.getByTestId('aide-card').first();

    if (await card.isVisible()) {
        console.log('Cards are visible!');
    } else if (await skeleton.isVisible()) {
        console.log('Still loading (Skeleton visible)...');
    } else if (await emptyState.isVisible()) {
        console.log('Empty state visible.');
    } else {
        console.log('Unknown state.');
    }

    // Fail if no cards to force log output inspection
    await expect(card).toBeVisible({ timeout: 1000 });
});
