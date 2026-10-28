import { expect, test } from './fixtures.js';

import { setupPublicMocks } from './_mocks/publicApiMocks.js';

test.describe('P10-2 provenance & trust layer', () => {
  test.beforeEach(async ({ page }) => {
    await setupPublicMocks(page);
  });

  test('shows freshness badges on aides and demarches listings', async ({ page }) => {
    await page.goto('/aides');
    await expect(page.getByTestId('aide-freshness-badge').first()).toBeVisible();

    await page.goto('/demarches');
    await expect(page.getByTestId('demarche-freshness-badge').first()).toBeVisible();
  });

  test('submits "Signaler une info" feedback from aide and demarche details', async ({ page }) => {
    /** @type {Array<Record<string, unknown>>} */
    const requests = [];

    await page.route('**/api/feedback', async (route) => {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          requestId: 'req-e2e-feedback',
          feedbackId: `feedback-${requests.length}`,
          message: 'Merci pour votre signalement.',
        }),
      });
    });

    await page.goto('/aides/aide-test');
    await page.getByTestId('feedback-button').click();
    await page.getByLabel('Votre message').fill('Le texte pourrait être mis à jour.');
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({
      type: 'aide',
      id: 'aide-1',
      slug: 'aide-test',
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/demarches/demarche-test');
    await page.getByTestId('feedback-button').click();
    await page.getByLabel('Votre message').fill('Une étape est à clarifier.');
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({
      type: 'demarche',
      id: 'demarche-1',
      slug: 'demarche-test',
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
