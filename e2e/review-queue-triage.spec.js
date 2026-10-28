import { test, expect } from './fixtures.js';

const BASE_ITEMS = [
  {
    id: 'rq-open-1',
    createdAt: '2026-03-12T10:00:00.000Z',
    entityType: 'aide',
    entityId: 'entity-1',
    entitySlug: 'aide-alpha',
    title: 'Alpha dossier',
    reason: 'MISSING_SLUG',
    severity: 'P0',
    status: 'open',
    details: { field: 'slug', ageDays: 310 },
  },
  {
    id: 'rq-open-2',
    createdAt: '2026-03-11T10:00:00.000Z',
    entityType: 'demarche',
    entityId: 'entity-2',
    entitySlug: 'demarche-beta',
    title: 'Beta dossier',
    reason: 'STALE_VERIFICATION',
    severity: 'P1',
    status: 'open',
    details: { ageDays: 400, staleDays: 365 },
  },
  {
    id: 'rq-closed-1',
    createdAt: '2026-03-10T10:00:00.000Z',
    entityType: 'structure',
    entityId: 'entity-3',
    entitySlug: 'structure-gamma',
    title: 'Gamma dossier',
    reason: 'MISSING_SOURCE_DOCUMENT',
    severity: 'P1',
    status: 'resolved',
    details: { field: 'source_document_id' },
  },
];

test.describe('P8-G review queue triage mode', () => {
  test('supports filters/search and bulk resolve action', async ({ page }) => {
    /** @type {Array<{ ids: string[], status: string }>} */
    const bulkPayloads = [];

    await page.addInitScript(() => {
      window.sessionStorage.setItem('access_token', 'test-admin-token');
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'admin-1',
            role: 'admin',
            email: 'admin@example.test',
          },
        }),
      });
    });

    await page.route('**/api/admin/review-queue/scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          requestId: 'scan-rq',
          created: 0,
          updated: 0,
          openTotal: 2,
          limitPerType: 50,
          scanned: { aides: 1, demarches: 1, structures: 0, actualites: 0 },
        }),
      });
    });

    await page.route('**/api/admin/review-queue/bulk', async (route) => {
      const postData = route.request().postDataJSON();
      bulkPayloads.push({
        ids: Array.isArray(postData?.ids) ? postData.ids : [],
        status: String(postData?.status || ''),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          requestId: 'bulk-rq',
          result: { updated: 2, skipped: 0, notFound: 0 },
        }),
      });
    });

    await page.route('**/api/admin/review-queue/*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (url.includes('/api/admin/review-queue/bulk')) {
        await route.fallback();
        return;
      }
      if (method === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            requestId: 'patch-rq',
            item: { id: 'rq-open-1', status: 'resolved' },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.route('**/api/admin/review-queue**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          requestId: 'list-rq',
          items: BASE_ITEMS,
          pagination: { limit: 50, nextCursor: null },
        }),
      });
    });

    await page.goto('/admin/review-queue');
    await expect(page.getByText('Alpha dossier')).toBeVisible();
    await expect(page.getByText('Beta dossier')).toBeVisible();

    await page.getByTestId('rq-search-input').fill('alpha');
    await expect(page.getByText('Alpha dossier')).toBeVisible();
    await expect(page.getByText('Beta dossier')).toHaveCount(0);

    await page.getByTestId('rq-search-input').fill('');
    await page.getByLabel('Gravité').selectOption('P0');
    await expect(page.getByText('Alpha dossier')).toBeVisible();
    await expect(page.getByText('Beta dossier')).toHaveCount(0);

    await page.getByLabel('Gravité').selectOption('');
    await expect(page.getByText('Beta dossier')).toBeVisible();

    await page.getByTestId('rq-select-rq-open-1').check();
    await page.getByTestId('rq-select-rq-open-2').check();
    await expect(page.getByTestId('rq-bulk-resolve')).toBeVisible();
    await page.getByTestId('rq-bulk-resolve').click();

    await expect.poll(() => bulkPayloads.length).toBe(1);
    expect(bulkPayloads[0]).toEqual({
      ids: ['rq-open-1', 'rq-open-2'],
      status: 'resolved',
    });

    await page.getByTestId('rq-details-toggle-rq-open-1').click();
    await expect(page.getByTestId('rq-details-rq-open-1')).toBeVisible();
  });
});
