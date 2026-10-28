import { test, expect } from './fixtures.js';
import { setupPublicMocks } from './_mocks/publicApiMocks.js';

test.describe('P10-A RDV public entrypoint', () => {
  test('redirects unauthenticated users to auth login with next from annuaire flow', async ({ page }) => {
    await setupPublicMocks(page);

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      });
    });

    await page.goto('/structures/structure-test');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /Prendre rendez-vous|Demander un RDV/i }).first().click();

    await expect(page).toHaveURL(/\/auth\/login\?next=%2Frdv%2Fstructure-test/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Connexion Particulier/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /Je n'ai pas de compte/i })).toBeVisible({ timeout: 15000 });
  });

  test('shows rdv unavailable screen when structure has not activated booking', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pro_token', 'test-pro-token');
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { kind: 'pro', authType: 'pro_jwt', role: 'pro' },
          user: { id: 'pro-1', role: 'pro', structureId: 'struct-1' },
        }),
      });
    });

    await page.route('**/api/structures**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'struct-1',
          slug: 'structure-test',
          nom: 'Structure Test',
          statut: 'actif',
          is_pro_enabled: false,
          proServices: [],
        }),
      });
    });

    await page.goto('/rdv/structure-test');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Rendez-vous indisponible (non publié)')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /Demander/i })).toBeVisible({ timeout: 15000 });
  });
});
