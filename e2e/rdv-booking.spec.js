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
          manageUrl: 'http://localhost:3000/rdv/structure-test/booking?appointment=apt-1',
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
          manageUrl: 'http://localhost:3000/rdv/structure-test/booking?appointment=apt-1',
        }),
      });
    });

    // R44: the legacy deep link /rdv/<slug>/services now lands on the account journey /rdv/<slug>/booking (same origin, validated slug)
    await page.goto('/rdv/structure-test/services');
    await page.waitForURL((u) => u.pathname === '/rdv/structure-test/booking');

    await expect(page.getByRole('heading', { name: 'Prendre rendez-vous' })).toBeVisible();
    await page.getByTestId('booking-service-svc-1').click();

    await page.getByTestId('booking-slot').first().click();
    await page.getByTestId('booking-confirm').click();

    await expect(page.getByTestId('booking-success')).toBeVisible();
    await expect(page.getByTestId('booking-state')).toHaveText('C’est confirmé !');
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

    await page.goto('/rdv/structure-test/creneaux?serviceId=svc-1');
    await page.waitForURL((u) => u.pathname === '/rdv/structure-test/booking' && u.searchParams.get('serviceId') === 'svc-1');

    await page.getByTestId('booking-slot').first().click();
    await page.getByTestId('booking-confirm').click();
    await expect(page.getByTestId('booking-slot-notice')).toContainText('Ce créneau vient d’être réservé');
    await expect(page.getByTestId('booking-success')).toHaveCount(0);
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

    await page.goto('/rdv/structure-test/booking');

    await page.getByTestId('booking-service-svc-1').click();
    await page.getByTestId('booking-slot').first().click();
    await page.getByTestId('booking-confirm').click();
    await expect(page.getByText(/Veuillez verifier votre email/i)).toBeVisible();
    await expect(page.getByTestId('booking-success')).toHaveCount(0);
  });
});
