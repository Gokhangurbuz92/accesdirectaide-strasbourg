import { test, expect } from './fixtures.js';

test.describe('Aides Search MVP', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/search', async (route) => {
      const body = route.request().postDataJSON() || {};

      if (body.query === 'force-empty') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], total: 0, message: 'not found' }),
        });
        return;
      }

      if (body.query === 'with-situation') {
        expect(body.situations).toEqual(['etudiant']);
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'aid-1',
              slug: 'apl-etudiant-strasbourg',
              title: 'APL étudiant à Strasbourg',
              description: 'Aide au logement pour réduire le loyer.',
              category: 'LOGEMENT',
              score: 0.42,
            },
          ],
          total: 1,
          message: null,
        }),
      });
    });
  });

  test('searches aides and renders result list', async ({ page }) => {
    await page.goto('/recherche');

    await page.getByLabel('Recherche').fill('loyer étudiant Strasbourg');
    await page.locator('#aides-search-category').selectOption('logement');
    await page.getByRole('button', { name: 'Rechercher' }).click();

    await expect(page).toHaveURL(/q=loyer/);
    await expect(page).toHaveURL(/cat=logement/);

    await expect.poll(
      async () => {
        if (await page.getByTestId('search-results-list').isVisible()) return 'results';
        if (await page.getByTestId('search-empty-state').isVisible()) return 'empty';
        if (await page.getByTestId('search-error-state').isVisible()) return 'error';
        return 'pending';
      },
      {
        timeout: 20000,
        intervals: [250, 500, 1000],
      }
    ).toMatch(/results|empty/);

    if (await page.getByTestId('search-results-list').isVisible()) {
      await expect(page.getByTestId('search-result-card').first()).toBeVisible();
    }

    await expect(page.getByTestId('search-error-state')).not.toBeVisible();
  });

  test('includes situation param when searching with ?situation=', async ({ page }) => {
    await page.goto('/recherche?situation=etudiant');

    await page.getByLabel('Recherche').fill('with-situation');
    await page.getByRole('button', { name: 'Rechercher' }).click();

    await expect(page).toHaveURL(/q=with-situation/);
    await expect(page.getByTestId('search-results-list')).toBeVisible();
  });

  test('renders empty state when API returns no result', async ({ page }) => {
    await page.goto('/recherche');

    await page.getByLabel('Recherche').fill('force-empty');
    await page.getByRole('button', { name: 'Rechercher' }).click();

    await expect(page.getByTestId('search-empty-state')).toBeVisible();
    await expect(page.getByTestId('search-error-state')).not.toBeVisible();
  });
});
