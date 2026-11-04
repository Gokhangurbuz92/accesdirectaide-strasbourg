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
    // R41: the account-free page is never reached when the server does not offer it (here no API answers the guest endpoint)
    expect(new URL(page.url()).pathname).not.toContain('/sans-compte');
  });

  test('shows rdv unavailable screen when structure has not activated booking', async ({ page }) => {
    // R44 (§1.2): /rdv/<slug> is a redirect to the account journey /rdv/<slug>/booking (citizen account required since R42); a structure without online
    // booking answers 404 on its services, and the journey says so honestly, with the ways to another structure — never an account-free entry
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { kind: 'user', authType: 'user_cookie', role: 'user' },
          user: { id: 'user-1', role: 'user', emailVerified: true },
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

    await page.route('**/api/rdv/structures/structure-test/services**', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'RDV indisponible' }) });
    });
    let slotCalls = 0; let bookingPosts = 0;
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.endsWith('/slots')) slotCalls += 1;
      if (u.pathname === '/api/rdv/appointments' && r.method() === 'POST') bookingPosts += 1;
    });

    await page.goto('/rdv/structure-test');
    await page.waitForURL((u) => u.pathname === '/rdv/structure-test/booking', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const empty = page.getByTestId('booking-services-empty');
    await expect(empty).toBeVisible({ timeout: 15000 });
    await expect(empty).toContainText("Aucun service n'est proposé en ligne pour cette structure");
    // the ways on: the structure page and the directory (another structure)
    await expect(empty.getByRole('link', { name: 'Revenir à la fiche de la structure' })).toHaveAttribute('href', '/structures/structure-test');
    await expect(empty.getByRole('link', { name: "Retour à l'annuaire" })).toHaveAttribute('href', '/structures');
    // R41: closed booking stays closed — no account-free entry and nothing bookable (R42: account-free booking retired, src/lib/guestBooking.js removed)
    await expect(page.getByTestId('rdv-guest-cta')).toHaveCount(0);
    await expect(page.locator('a[href*="/sans-compte"]')).toHaveCount(0);
    await expect(page.getByTestId('booking-slot')).toHaveCount(0);
    await expect(page.getByTestId('booking-confirm')).toHaveCount(0);
    expect(slotCalls, 'no slot is asked for a structure without online booking').toBe(0);
    expect(bookingPosts).toBe(0);
  });
});
