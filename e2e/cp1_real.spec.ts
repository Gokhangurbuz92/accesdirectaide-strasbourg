
import { test, expect } from './fixtures.js';

test('CP1 Real: Navigation Listing -> Detail', async ({ page }) => {
    await page.goto('/aides');

    // Wait for at least one AideCard
    const card = page.getByTestId('aide-card').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Click the anchor link inside the card
    const link = page.getByTestId('aide-card-link').first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    console.log('Target href:', href);

    // Take evidence screenshot of the DOM link
    await page.screenshot({ path: 'release/v1.0.0/proofs/01-nav/dom-link-evidence.png' });

    // Perform Navigation
    await link.click();

    // Verify Detail Page
    await expect(page).toHaveURL(new RegExp(href!));

    // And show content (titre H1)
    await expect(page.locator('h1')).toBeVisible();
});
