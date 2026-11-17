import { test, expect } from './fixtures.js';

// C12 (QA v43): the public API only returns documents a person verified against an official source (api/_services/resource-publication.js publicView:
// source_publisher, source_url, verified_at, published_at, freshness — never the reviewer); the fixtures below have that shape, and the detail page shows
// the « Source officielle » block (publisher, link to the source, « Vérifié le ») instead of the former « Source et traçabilité » panel.
const VERIFIED_AT = new Date(Date.now() - 5 * 86400000).toISOString();
const PUBLISHED = {
    id: 'test-ressource-1',
    slug: 'test-ressource-slug',
    title: 'Ressource Test E2E',
    type: 'guide',
    territory_scope: null,
    source_url: 'https://www.caf.fr/allocataires/mes-services-en-ligne',
    source_publisher: 'Caf — Caisse nationale des allocations familiales',
    verified_at: VERIFIED_AT,
    published_at: VERIFIED_AT,
    freshness: 'current'
};
const VERIFIED_DATE = /Vérifié le\s*:?\s*\d{1,2}\s+\S+\s+\d{4}/;

/** the official-source block of the detail page: publisher, a link to the source (new tab), the verification date */
async function expectSourceBlock(page) {
    const block = page.getByRole('region', { name: 'Source officielle' });
    await expect(block).toBeVisible();
    await expect(block).toContainText(PUBLISHED.source_publisher);
    const link = block.getByRole('link', { name: /caf\.fr/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', PUBLISHED.source_url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(block.getByTestId('ressource-verified')).toContainText(VERIFIED_DATE);
}

test.describe('Ressources Module Navigation', () => {
    test.beforeEach(async ({ page }) => {
        // Mock API responses (verified, published documents only — as the real /api/ressources)
        await page.route('**/api/ressources*', async route => {
            const url = route.request().url();

            if (url.includes('slug=') || url.includes('id=')) {
                // Detail response
                await route.fulfill({ json: { ...PUBLISHED, content: 'Contenu détaillé de la ressource de test' } });
            } else {
                // List response
                await route.fulfill({
                    json: {
                        items: [{ ...PUBLISHED, content: 'Description courte ressource' }],
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
        // the card carries its official source and its verification date
        await expect(card.getByTestId('ressource-source')).toContainText(PUBLISHED.source_publisher);
        await expect(card.getByTestId('ressource-verified')).toContainText(VERIFIED_DATE);

        await card.click();

        // Verify navigation to detail page
        await expect(page).toHaveURL(/\/ressources\/[\w-]+/);

        // Verify detail page content
        await expect(page.locator('h1')).toContainText(cardTitle);

        // Verify the traceability (official source) section is visible
        await expectSourceBlock(page);
    });

    test('should display source traceability on detail page', async ({ page }) => {
        await page.goto('/ressources/test-ressource-slug');

        await page.waitForLoadState('networkidle');

        // Check for the traceability (official source) section: publisher, source URL, verification date
        await expectSourceBlock(page);
        await expect(page.getByText(PUBLISHED.source_url)).toBeVisible();
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
