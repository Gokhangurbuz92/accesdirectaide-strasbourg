import { test, expect } from './fixtures.js';

test.describe('P10-C RDV publish settings', () => {
  test('public flow shows unpublished state when structure RDV is not published', async ({ page }) => {
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { kind: 'user', authType: 'user_cookie', role: 'user' },
          user: { id: 'user-1', role: 'user' },
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
          is_pro_enabled: true,
          rdv: {
            isPublished: false,
            bookingMode: 'IN_PERSON',
          },
          proServices: [{ id: 'svc-1', name: 'Accompagnement' }],
        }),
      });
    });

    // R44 (§1.2): /rdv/<slug> redirects to the account journey /rdv/<slug>/booking; an unpublished agenda answers 404 on its services (the API's own rule)
    await page.route('**/api/rdv/structures/structure-test/services**', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'RDV indisponible' }) });
    });

    await page.goto('/rdv/structure-test');
    await page.waitForURL((u) => u.pathname === '/rdv/structure-test/booking', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const empty = page.getByTestId('booking-services-empty');
    await expect(empty).toBeVisible({ timeout: 15000 });
    await expect(empty).toContainText("Aucun service n'est proposé en ligne pour cette structure");
    await expect(empty.getByRole('link', { name: "Retour à l'annuaire" })).toHaveAttribute('href', '/structures');
    await expect(page.getByTestId('booking-service-svc-1')).toHaveCount(0);   // the unpublished agenda's service is never offered
    await expect(page.locator('a[href*="/sans-compte"]')).toHaveCount(0);
  });

  test('public flow shows stepper when structure RDV is published', async ({ page }) => {
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { kind: 'user', authType: 'user_cookie', role: 'user' },
          user: { id: 'user-1', role: 'user' },
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
          rdv: {
            isPublished: true,
            bookingMode: 'BOTH',
          },
          proServices: [{ id: 'svc-1', name: 'Accompagnement' }],
        }),
      });
    });

    // R44 (§1.2): /rdv/<slug>/services redirects to the account journey; the published agenda's services and the steps are shown
    await page.route('**/api/rdv/structures/structure-test/services**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          teamChoice: false,
          structure: { slug: 'structure-test', name: 'Structure Test', bookingMode: 'BOTH', modes: ['IN_PERSON', 'VIDEO'], location: null },
          video: { available: true, sandbox: true },
          items: [{ id: 'svc-1', name: 'Accompagnement', durationMinutes: 30, modes: ['IN_PERSON', 'VIDEO'], confirmation: 'DIRECT' }],
        }),
      });
    });

    await page.goto('/rdv/structure-test/services');
    await page.waitForURL((u) => u.pathname === '/rdv/structure-test/booking', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const steps = page.getByTestId('booking-progress');
    await expect(steps).toBeVisible({ timeout: 15000 });
    await expect(steps.getByRole('listitem')).toHaveCount(5);
    await expect(steps.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: 'Choisissez un service' })).toBeVisible({ timeout: 15000 });
    await page.getByTestId('booking-service-svc-1').click();
    // the next step of a two-modality service: how to be received, then « Voir les créneaux disponibles »
    await expect(page.getByTestId('booking-modality')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Voir les/i })).toBeVisible({ timeout: 15000 });
    await expect(steps.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'step');
  });

  test('pro services page updates publish settings through PUT endpoint', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pro_token', 'pro-token-test');
    });

    let putCalled = false;

    await page.route('**/api/pro/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'pro-user-1',
            email: 'pro@test.local',
            role: 'STRUCTURE_ADMIN',
            structureId: 'struct-1',
            structure: {
              id: 'struct-1',
              slug: 'structure-test',
            },
          },
          structure: {
            id: 'struct-1',
            slug: 'structure-test',
          },
        }),
      });
    });

    await page.route('**/api/monitor/pro-rdv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, missingTables: [], missingMigrations: [] }),
      });
    });

    await page.route('**/api/pro/services**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/api/pro/rdv/settings', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'settings-1',
            structureId: 'struct-1',
            isPublished: false,
            bookingMode: 'IN_PERSON',
            contactEmail: null,
            contactPhone: null,
            publishedAt: null,
          }),
        });
        return;
      }

      if (method === 'PUT') {
        putCalled = true;
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'settings-1',
            structureId: 'struct-1',
            isPublished: Boolean(body.isPublished),
            bookingMode: body.bookingMode || 'IN_PERSON',
            contactEmail: body.contactEmail || null,
            contactPhone: body.contactPhone || null,
            publishedAt: body.isPublished ? '2026-03-10T10:00:00.000Z' : null,
          }),
        });
        return;
      }

      await route.fallback();
    });

    await page.goto('/pro/rdv/services');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('pro-rdv-settings-card')).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Publier la prise de RDV en ligne').check();
    await page.getByRole('button', { name: 'Enregistrer les paramètres' }).click();

    await expect.poll(() => putCalled, { timeout: 15000 }).toBe(true);
    await expect(page.getByText('Paramètres RDV enregistrés.')).toBeVisible({ timeout: 15000 });
  });
});
