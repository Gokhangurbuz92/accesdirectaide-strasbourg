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

    await page.goto('/rdv/structure-test');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Rendez-vous indisponible (non publié)')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /Demander/i })).toBeVisible({ timeout: 15000 });
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

    await page.goto('/rdv/structure-test/services');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Choix du service' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /Voir les/i })).toBeVisible({ timeout: 15000 });
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
    await page.getByRole('button', { name: 'Enregistrer les parametres' }).click();

    await expect.poll(() => putCalled, { timeout: 15000 }).toBe(true);
    await expect(page.getByText('Parametres RDV enregistres.')).toBeVisible({ timeout: 15000 });
  });
});
