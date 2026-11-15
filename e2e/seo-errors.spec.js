import { test, expect } from './fixtures.js';

test.describe('P7-F SEO errors', () => {
  test('unknown route renders noindex metadata with canonical', async ({ page }) => {
    await page.goto('/route-qui-nexiste-pas-123');

    const origin = new URL(page.url()).origin;
    const expectedCanonical = `${origin}/route-qui-nexiste-pas-123`;

    await expect(page).toHaveTitle(/(?:404|introuvable).*Acc[eè]s\s*Direct\s*Aide/i);
    await expect(page.locator('h1')).toContainText(/(?:introuvable|404)/i);
    await expect(page.locator('head meta[name="robots"]').last()).toHaveAttribute(
      'content',
      /noindex,\s*nofollow/i,
    );
    await expect(page.locator('head link[rel="canonical"]').last()).toHaveAttribute(
      'href',
      expectedCanonical,
    );
  });

  test('/aides/:slug missing renders not found with noindex', async ({ page }) => {
    await page.route('**/api/aides/slug-inexistant-123', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Aide non trouvée' }),
      });
    });

    await page.goto('/aides/slug-inexistant-123');
    // VIS: a record page says « Fiche non disponible » (unknown, or being checked: the API gives one 404 for both) and shows a person to ask
    await expect(page.locator('h1')).toContainText(/fiche non disponible/i);
    await expect(page.getByTestId('human-help-block')).toBeVisible();
    await expect(page.locator('head meta[name="robots"]').last()).toHaveAttribute(
      'content',
      /noindex,\s*nofollow/i,
    );
    await expect(page).toHaveTitle(/fiche non disponible.*Acc[eè]s\s*Direct\s*Aide/i);
  });

  test('/aides/:slug gone renders gone with noindex', async ({ page }) => {
    await page.route('**/api/aides/slug-retire-410', async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Gone' }),
      });
    });

    await page.goto('/aides/slug-retire-410');
    await expect(page.locator('h1')).toContainText(/contenu retiré/i);
    await expect(page.locator('head meta[name="robots"]').last()).toHaveAttribute(
      'content',
      /noindex,\s*nofollow/i,
    );
    await expect(page).toHaveTitle(/contenu retiré.*Accès Direct Aide/i);
  });
});
