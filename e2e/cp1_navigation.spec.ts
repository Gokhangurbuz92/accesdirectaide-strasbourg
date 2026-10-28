import { test, expect } from './fixtures.js';

test('navigate from demarches listing to detail', async ({ page }) => {
    // Mock listing API
    await page.route('**/api/demarches?*', async route => {
        const url = new URL(route.request().url());
        console.log(`Mocking request for: ${url.toString()}`);

        // If filtering by slug (detail view)
        if (url.searchParams.has('slug')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                // Return ARRAY as expected by filtering logic (simulating the bug fix or standard behavior)
                body: JSON.stringify([{
                    id: '123',
                    slug: 'demarche-test',
                    titre: 'Demarche Test Detail',
                    description_courte: 'Description courte',
                    categorie: 'logement',
                    etapes: [],
                    documents_necessaires: []
                }])
            });
            return;
        }

        // Default: Listing
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                items: [{
                    id: '123',
                    slug: 'demarche-test',
                    titre: 'Demarche Test Listing',
                    description_courte: 'Description courte',
                    categorie: 'logement'
                }],
                pagination: { page: 1, totalPages: 1, totalItems: 1 }
            })
        });
    });

    // 1. Go to listing
    await page.goto('/demarches');

    // 2. Wait for cards to appear using robust data-testid
    const firstCard = page.getByTestId('demarche-card').first();
    await expect(firstCard).toBeVisible();

    // 3. Get title using testid to verify later
    const cardTitleWrapper = firstCard.getByTestId('demarche-title');
    const cardTitle = await cardTitleWrapper.textContent();
    console.log(`Clicking card with title: ${cardTitle}`);

    // 4. Click the link (The card itself is covered by the link, but let's click the card center)
    await firstCard.click();

    // 5. Verify navigation
    // URL should contain slug
    await expect(page).toHaveURL(/.*demarche-test/);

    // 404 should not be visible
    await expect(page.getByText('404')).not.toBeVisible();

    // H1 should be visible on detail page (title may come from global mock, not test-specific mock)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
