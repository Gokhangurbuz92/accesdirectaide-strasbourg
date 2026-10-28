import { test, expect } from './fixtures.js';
import { setupPublicMocks } from './_mocks/publicApiMocks.js';

test.describe('P10-0 Public credibility fixes', () => {
  test('demarches listing no longer exposes "Démarche Test"', async ({ page }) => {
    await setupPublicMocks(page);
    await page.goto('/demarches');

    await expect(page.getByTestId('demarche-title').filter({ hasText: 'Demander le RSA' })).toBeVisible();
    await expect(page.getByText('Démarche Test')).toHaveCount(0);
  });

  test('actualite detail renders readable text without raw HTML tags', async ({ page }) => {
    await setupPublicMocks(page);

    await page.route('**/api/actualites**', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/actualites/actu-html')) {
        return route.fulfill({
          json: {
            id: 'actu-html',
            slug: 'actu-html',
            titre: 'Actualite HTML',
            contenu: '<p>Paragraphe important</p><p>Deuxieme bloc</p>',
            summary_falc: '<p>Resume <strong>officiel</strong></p>',
            date_publication: new Date().toISOString(),
            published_at: new Date().toISOString(),
            type_actu: 'info',
          },
        });
      }
      return route.fulfill({
        json: {
          items: [
            {
              id: 'actu-html',
              slug: 'actu-html',
              titre: 'Actualite HTML',
              resume: '<p>Resume <strong>officiel</strong></p>',
              date_publication: new Date().toISOString(),
              published_at: new Date().toISOString(),
              type_actu: 'info',
            },
          ],
          pagination: { total: 1, page: 1, pageSize: 10, totalPages: 1 },
        },
      });
    });

    await page.goto('/actualites/actu-html');
    await expect(page.getByRole('heading', { level: 1, name: 'Actualite HTML' })).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Paragraphe important');
    expect(bodyText).not.toContain('<p>');
    expect(bodyText).not.toContain('</p>');
  });

  test('home actualites section is either populated or hidden (never empty)', async ({ page }) => {
    await setupPublicMocks(page);
    await page.goto('/');

    const heading = page.getByRole('heading', { level: 2, name: 'Actualités officielles' });
    if (await heading.isVisible()) {
      await expect(page.getByText('Actualité Test')).toBeVisible();
      await expect(page.getByText('Aucune actualité chargée pour le moment')).toHaveCount(0);
    } else {
      await expect(heading).toHaveCount(0);
    }
  });

  test('annuaire sticky filters do not block top navigation clicks', async ({ page }) => {
    await setupPublicMocks(page);
    await page.goto('/structures');
    await page.evaluate(() => window.scrollTo(0, 800));

    const aidesLink = page.getByRole('link', { name: 'Aides' }).first();
    await expect(aidesLink).toBeVisible();
    await aidesLink.click();
    await expect(page).toHaveURL(/\/aides/);
  });

  test('mon assistant route redirects to orientation', async ({ page }) => {
    await setupPublicMocks(page);
    await page.goto('/mon-assistant');

    // /mon-assistant now redirects to /orientation
    await expect(page).toHaveURL(/\/orientation/, { timeout: 5000 });
  });
});
