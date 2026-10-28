import { test, expect } from './fixtures.js';

function mockCommonRdvContext(page) {
  return Promise.all([
    page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { kind: 'user', authType: 'user_cookie', role: 'user' },
          user: { id: 'user-1', role: 'user', emailVerified: true },
        }),
      });
    }),
    page.route('**/api/structures**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'struct-1',
          slug: 'structure-test',
          nom: 'Structure Test',
          statut: 'actif',
          is_pro_enabled: true,
          rdv: {
            isPublished: true,
            bookingMode: 'IN_PERSON',
          },
        }),
      });
    }),
    page.route('**/api/rdv/structures/structure-test/services', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          structure: {
            slug: 'structure-test',
            name: 'Structure Test',
            bookingMode: 'IN_PERSON',
          },
          items: [
            {
              id: 'svc-1',
              name: 'Accompagnement social',
              durationMinutes: 30,
              bufferBeforeMinutes: 0,
              bufferAfterMinutes: 0,
            },
          ],
        }),
      });
    }),
    page.route('**/api/rdv/structures/structure-test/slots**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: 'Europe/Paris',
          total: 1,
          slots: [
            {
              startAt: '2026-03-02T09:00:00.000Z',
              endAt: '2026-03-02T09:30:00.000Z',
            },
          ],
          days: [
            {
              date: '2026-03-02',
              slots: [
                {
                  startAt: '2026-03-02T09:00:00.000Z',
                  endAt: '2026-03-02T09:30:00.000Z',
                },
              ],
            },
          ],
        }),
      });
    }),
  ]);
}

test.describe('P10-D public booking flow', () => {
  test('books a slot and shows confirmation', async ({ page }) => {
    await mockCommonRdvContext(page);

    await page.route('**/api/rdv/appointments', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'apt-1',
          status: 'CONFIRMED',
          startsAt: '2026-03-02T09:00:00.000Z',
          endsAt: '2026-03-02T09:30:00.000Z',
          structure: { id: 'struct-1', slug: 'structure-test', name: 'Structure Test' },
          service: { id: 'svc-1', name: 'Accompagnement social', durationMinutes: 30 },
          manageUrl: 'http://localhost:3000/rdv/structure-test/creneaux?appointment=apt-1',
        }),
      });
    });

    await page.route('**/api/rdv/appointments/apt-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'apt-1',
          status: 'CONFIRMED',
          startsAt: '2026-03-02T09:00:00.000Z',
          endsAt: '2026-03-02T09:30:00.000Z',
          structure: { id: 'struct-1', slug: 'structure-test', name: 'Structure Test' },
          service: { id: 'svc-1', name: 'Accompagnement social', durationMinutes: 30 },
          manageUrl: 'http://localhost:3000/rdv/structure-test/creneaux?appointment=apt-1',
        }),
      });
    });

    await page.goto('/rdv/structure-test/services');

    await expect(page.getByRole('heading', { name: 'Choix du service' })).toBeVisible();
    await page.getByTestId('choose-service-svc-1').click();
    await page.getByRole('link', { name: /Voir les creneaux/i }).click();

    await expect(page.getByRole('heading', { name: 'Choix du creneau' })).toBeVisible();
    await page.locator('[data-testid^="rdv-slot-"]').first().click();

    await expect(page.getByTestId('rdv-booking-confirmation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'RDV confirme' })).toBeVisible();
  });

  test('shows conflict message when selected slot is no longer available', async ({ page }) => {
    await mockCommonRdvContext(page);

    await page.route('**/api/rdv/appointments', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Slot no longer available' }),
      });
    });

    await page.goto('/rdv/structure-test/services');

    await page.getByTestId('choose-service-svc-1').click();
    await page.getByRole('link', { name: /Voir les creneaux/i }).click();

    await page.locator('[data-testid^="rdv-slot-"]').first().click();
    await expect(page.getByText(/n'est plus disponible/i)).toBeVisible();
  });

  test('shows verification message when user email is not verified', async ({ page }) => {
    await mockCommonRdvContext(page);

    await page.route('**/api/rdv/appointments', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Email verification required', code: 'EMAIL_NOT_VERIFIED' }),
      });
    });

    await page.goto('/rdv/structure-test/services');

    await page.getByTestId('choose-service-svc-1').click();
    await page.getByRole('link', { name: /Voir les creneaux/i }).click();

    await page.locator('[data-testid^="rdv-slot-"]').first().click();
    await expect(page.getByText(/Veuillez verifier votre email/i)).toBeVisible();
  });
});
