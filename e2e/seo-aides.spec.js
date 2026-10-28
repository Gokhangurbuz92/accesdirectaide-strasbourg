import { test, expect } from './fixtures.js';

const LIST_ITEM = {
  id: 'aide-seo-1',
  slug: 'aide-seo-test',
  titre: 'Aide SEO Test',
  summary_falc: 'Description courte SEO pour la liste.',
  cest_quoi: 'Description longue SEO pour la page de liste.',
  categorie: 'logement',
  statut: 'publie',
};

const DETAIL_ITEM = {
  ...LIST_ITEM,
  summary_falc: 'Description courte SEO pour la fiche détail.',
  pour_qui: 'Étudiants et jeunes actifs',
  territoires: ['national'],
  sources: [],
};

function parseJsonLdEntries(rawScripts) {
  return rawScripts.flatMap((raw) => {
    if (!raw || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  });
}

async function setupAidesSeoMocks(page) {
  await page.route('**/api/taxonomy*', async (route) => {
    await route.fulfill({
      json: {
        categories: [{ slug: 'logement', label: 'Logement' }],
        aidSituations: [{ code: 'etudiant', label: 'Étudiant' }],
      },
    });
  });

  await page.route('**/api/aides**', async (route) => {
    const url = route.request().url();
    // Detail request: /api/aides/aide-seo-test (path param, not query)
    if (url.includes('/api/aides/aide-seo-test')) {
      await route.fulfill({ json: DETAIL_ITEM });
      return;
    }
    // List request: /api/aides or /api/aides?...
    await route.fulfill({
      json: {
        items: [LIST_ITEM],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false },
      },
    });
  });

  await page.route('**/api/structures*', async (route) => {
    await route.fulfill({
      json: { items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } },
    });
  });
}

test.describe('SEO Runtime - Aides', () => {
  test.beforeEach(async ({ page }) => {
    await setupAidesSeoMocks(page);
  });

  test('/aides exposes runtime metadata and semantic links', async ({ page }) => {
    await page.goto('/aides');
    // Wait for content to render instead of waitForResponse (mock already fulfilled)
    await expect(page.locator('a[href="/aides/aide-seo-test"]')).toBeVisible({ timeout: 10000 });

    const origin = new URL(page.url()).origin;
    const expectedCanonical = `${origin}/aides`;

    await expect(page).toHaveTitle(/Aides.*Accès Direct Aide/i);
    await expect(page.locator('head meta[name="description"]').last()).toHaveAttribute('content', /aides/i);
    await expect(page.locator('head link[rel="canonical"]').last()).toHaveAttribute('href', expectedCanonical);
    await expect(page.locator('head meta[property="og:url"]').last()).toHaveAttribute('content', expectedCanonical);
    await expect(page.locator('head meta[name="twitter:card"]').last()).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('a[href="/aides/aide-seo-test"]')).toHaveCount(1);

    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts.first()).toBeAttached();
    const entries = parseJsonLdEntries(await scripts.allTextContents());
    expect(entries.some((entry) => entry?.['@type'] === 'BreadcrumbList')).toBe(true);
    expect(entries.some((entry) => entry?.['@type'] === 'ItemList')).toBe(true);
  });

  test('/aides/:slug updates metadata from loaded aide data', async ({ page }) => {
    await page.goto('/aides/aide-seo-test');
    // Wait for the actual aide data to render (not just loading skeleton)
    await expect(page.locator('h1')).toContainText('Aide SEO Test', { timeout: 15000 });

    const origin = new URL(page.url()).origin;
    const expectedCanonical = `${origin}/aides/aide-seo-test`;

    await expect(page).toHaveTitle(/Aide SEO Test.*Accès Direct Aide/i);
    await expect(page.locator('head meta[name="description"]').last()).toHaveAttribute('content', /Description courte SEO/i);
    await expect(page.locator('head link[rel="canonical"]').last()).toHaveAttribute('href', expectedCanonical);
    await expect(page.locator('head meta[property="og:url"]').last()).toHaveAttribute('content', expectedCanonical);
    await expect(page.locator('[data-testid="aide-breadcrumb"]')).toBeVisible();

    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts.first()).toBeAttached({ timeout: 10000 });

    const entries = parseJsonLdEntries(await scripts.allTextContents());
    expect(entries.some((entry) => entry?.['@type'] === 'BreadcrumbList')).toBe(true);

    const webPageEntry = entries.find((entry) => entry?.['@type'] === 'WebPage');
    expect(webPageEntry?.mainEntity?.['@type']).toBe('GovernmentService');
    expect(webPageEntry?.mainEntity?.name).toBe('Aide SEO Test');
  });
});
