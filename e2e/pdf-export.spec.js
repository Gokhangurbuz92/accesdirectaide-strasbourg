import { test, expect } from './fixtures.js';

import { setupPublicMocks } from './_mocks/publicApiMocks.js';

const PDF_FIXTURE = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
  'utf8',
);

async function setupPdfMocks(page) {
  await page.route('**/api/pdf/**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="fiche-test.pdf"',
      },
      body: PDF_FIXTURE,
    });
  });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function assertPdfEndpointFromPage(page) {
  await page.evaluate(() => {
    window.__pdfOpenedUrl = null;
    const originalOpen = window.open;
    window.__restorePdfOpen = () => {
      window.open = originalOpen;
    };
    window.open = (url) => {
      window.__pdfOpenedUrl = typeof url === 'string' ? url : String(url || '');
      return null;
    };
  });

  const button = page.getByRole('button', { name: /Télécharger en PDF/i }).first();
  await expect(button).toBeVisible();
  await button.click();

  const href = await page.evaluate(() => window.__pdfOpenedUrl);
  expect(href).toBeTruthy();

  const result = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const signature = String.fromCharCode(...Array.from(new Uint8Array(buffer).slice(0, 5)));

    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      signature,
    };
  }, href);

  expect(result.status).toBe(200);
  expect(result.contentType.toLowerCase()).toContain('application/pdf');
  expect(result.signature).toBe('%PDF-');

  await page.evaluate(() => {
    if (typeof window.__restorePdfOpen === 'function') {
      window.__restorePdfOpen();
    }
  });
}

test.describe('P10-3 PDF export', () => {
  test.beforeEach(async ({ page }) => {
    await setupPublicMocks(page);
    await setupPdfMocks(page);
  });

  test('aide detail exposes a stable PDF endpoint', async ({ page }) => {
    await page.goto('/aides/aide-test');
    await expect(page.getByText('Description longue')).toBeVisible();
    await assertPdfEndpointFromPage(page);
  });

  test('demarche detail exposes a stable PDF endpoint', async ({ page }) => {
    await page.goto('/demarches/demarche-test');
    await expect(page.getByText('Resume demarche RSA.').first()).toBeVisible();
    await assertPdfEndpointFromPage(page);
  });
});
