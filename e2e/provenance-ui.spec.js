import { test, expect } from './fixtures.js';

function buildAideDetail(slug, verifiedAt) {
  return {
    id: `aide-${slug}`,
    slug,
    titre: `Aide ${slug}`,
    cest_quoi: 'Description aide test provenance',
    pour_qui: 'Public test',
    categorie: 'logement',
    territoires: ['national'],
    documents_necessaires: ['piece-identite'],
    statut: 'publie',
    provenance: {
      verifiedAt,
      fetchedAt: '2026-02-15T09:00:00.000Z',
      sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F12006',
      sourceHost: 'www.service-public.fr',
    },
  };
}

async function setupProvenanceMocks(page) {
  await page.route('**/api/aides**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/aides/aide-provenance-a-jour')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildAideDetail('aide-provenance-a-jour', '2026-01-15T10:00:00.000Z')),
      });
      return;
    }
    if (url.includes('/api/aides/aide-provenance-a-verifier')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildAideDetail('aide-provenance-a-verifier', '2025-10-01T10:00:00.000Z')),
      });
      return;
    }
    if (url.includes('/api/aides/aide-provenance-non-verifie')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildAideDetail('aide-provenance-non-verifie', null)),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'aide-1',
            slug: 'aide-provenance-a-jour',
            titre: 'Aide test',
            cest_quoi: 'Resume',
            categorie: 'logement',
            statut: 'publie',
            provenance: {
              verifiedAt: '2026-01-15T10:00:00.000Z',
              fetchedAt: '2026-02-15T09:00:00.000Z',
              sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F12006',
              sourceHost: 'www.service-public.fr',
            },
          },
        ],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1, hasNext: false },
      }),
    });
  });

  await page.route('**/api/structures**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], pagination: { total: 0, page: 1, limit: 5, totalPages: 0 } }),
    });
  });

  await page.route('**/api/taxonomy**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: [{ slug: 'logement', label: 'Logement' }],
        aidSituations: [],
      }),
    });
  });
}

test.describe('P8-E provenance and freshness UI', () => {
  test.beforeEach(async ({ page }) => {
    // Stable reference date for provenance freshness tests.
    await page.clock.setFixedTime(new Date('2026-03-01T12:00:00.000Z'));
    await setupProvenanceMocks(page);
  });

  test('shows provenance block with source link and À jour badge', async ({ page }) => {
    await page.goto('/aides/aide-provenance-a-jour');
    // Wait for provenance content to render instead of waitForResponse
    await expect(page.locator('[data-testid="provenance-freshness"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="freshness-badge"]')).toContainText('À jour');
    await expect(page.getByRole('link', { name: /Voir la source officielle/i })).toHaveAttribute(
      'href',
      'https://www.service-public.fr/particuliers/vosdroits/F12006',
    );
  });

  test('shows À vérifier badge when verification is older than 90 days', async ({ page }) => {
    await page.goto('/aides/aide-provenance-a-verifier');
    // Wait for content to render
    await expect(page.locator('[data-testid="freshness-badge"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="freshness-badge"]')).toContainText('actualiser');
  });

  test('shows À vérifier badge when verification is missing', async ({ page }) => {
    await page.goto('/aides/aide-provenance-non-verifie');
    // Wait for content to render
    await expect(page.locator('[data-testid="freshness-badge"]')).toBeVisible({ timeout: 10000 });
  });
});
