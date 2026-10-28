import { test, expect } from './fixtures.js';
import { setupPublicMocks } from './_mocks/publicApiMocks';

// Timeout global augmenté
test.setTimeout(60000);

test.describe('Public Navigation Smoke Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Utilisation des mocks partagés pour garantir la cohérence
    await setupPublicMocks(page);
  });

  test('Aides Flow: List -> Detail -> Refresh -> Back', async ({ page }) => {
    await page.goto('/aides');

    // Wait for an aide card to be visible
    await expect(page.getByTestId('aide-card').first()).toBeVisible();

    // Click the link inside the card
    await page.getByTestId('aide-card-link').first().click();

    await expect(page).toHaveURL(/\/aides\/aide-test/);
    // Detail page shows the aide title in h1
    await expect(page.locator('h1')).toBeVisible();

    await page.reload();
    await expect(page.locator('h1')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/aides/);
  });

  test('Demarches Flow: List -> Detail -> Refresh -> Back', async ({ page }) => {
    await page.goto('/demarches');
    await expect(page.getByTestId('demarche-card').first()).toBeVisible();

    // Click the card (DemarcheCard has overlay link)
    await page.getByTestId('demarche-card').first().click();

    await expect(page).toHaveURL(/\/demarches\/demarche-test/);
    await expect(page.locator('h1')).toBeVisible();

    await page.reload();
    await expect(page.locator('h1')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/demarches/);
  });

  test('Structures Flow: List -> Detail -> Refresh -> Back', async ({ page }) => {
    await page.goto('/structures');
    await expect(page.getByTestId('structure-card').first()).toBeVisible();

    // Use evaluate to programmatically click the overlay link (z-20 contact elements block normal clicks)
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="structure-card"]');
      const link = card?.querySelector('a');
      if (link) link.click();
    });

    await expect(page).toHaveURL(/\/structures\/structure-test/);
    await expect(page.locator('h1')).toBeVisible();

    await page.reload();
    await expect(page.locator('h1')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/structures/);
  });

});