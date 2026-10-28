import { test, expect } from './fixtures.js';

async function mockStatusEndpoints(page, options = {}) {
  const dataQualityStatus = options.dataQualityStatus ?? 200;
  const ingestionStatus = options.ingestionStatus ?? 200;

  await page.route('**/api/monitor/data-quality', async (route) => {
    await route.fulfill({
      status: dataQualityStatus,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
      body: JSON.stringify({
        ok: dataQualityStatus === 200,
        requestId: 'rq-dq-1',
        metrics: {
          openTotal: dataQualityStatus === 200 ? 10 : 520,
          openP0: dataQualityStatus === 200 ? 2 : 30,
          openP1: dataQualityStatus === 200 ? 8 : 490,
        },
        thresholds: { openTotalMax: 500, openP0Max: 25 },
        ...(dataQualityStatus === 200 ? {} : { error: 'unavailable' }),
      }),
    });
  });

  await page.route('**/api/monitor/ingestion-freshness', async (route) => {
    await route.fulfill({
      status: ingestionStatus,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
      body: JSON.stringify({
        ok: ingestionStatus === 200,
        requestId: 'rq-ing-1',
        state: ingestionStatus === 200 ? 'fresh' : 'stale',
        latestFetchedAt: '2026-03-10T10:00:00.000Z',
        ageHours: ingestionStatus === 200 ? 2 : 96,
        thresholdHours: 48,
        ...(ingestionStatus === 200 ? {} : { error: 'unavailable' }),
      }),
    });
  });
}

// P24 overlay v1 (STRASBOURG_FULL_PRODUCT_PLAN/P24_PUBLIC_STATUS_OVERLAY_V1.md): the public page no longer shows the two internal monitor cards (protected endpoints,
// internal counts); it reads GET /api/status. Test TITLES are kept (frozen inventory fingerprint); bodies assert the new public contract: worded sections, noindex,
// no internal metric, honest error when the status itself is unavailable. mockStatusEndpoints is kept and still routed, to prove the page no longer calls the monitors.
async function mockPublicStatus(page, status) {
  await page.route('**/api/status', async (route) => route.fulfill({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(status === 200 ? { checkedAt: '2026-03-10T10:00:00.000Z', components: [
      { id: 'site', label: 'Site', state: 'operational', text: 'Le site répond.' },
      { id: 'comptes', label: 'Comptes et rendez-vous', state: 'operational', text: 'Les comptes fonctionnent.' },
      { id: 'emails', label: 'E-mails', state: 'unavailable', text: "L'envoi des e-mails n'est pas configuré." },
      { id: 'assistant', label: 'Assistant', state: 'unavailable', text: "L'assistant est indisponible." },
      { id: 'donnees', label: 'Informations sur les aides', state: 'info', text: 'En cours de vérification.' }] } : { error: 'unavailable' }) }));
}

test.describe('P8-G status page', () => {
  test('renders both monitor cards and keeps page noindex', async ({ page }) => {
    await mockStatusEndpoints(page, { dataQualityStatus: 200, ingestionStatus: 200 });
    await mockPublicStatus(page, 200);
    const monitorCalls = []; page.on('request', (r) => { if (/\/api\/monitor\//.test(r.url())) monitorCalls.push(r.url()); });
    const statusResponse = page.waitForResponse((response) => response.url().includes('/api/status'));
    await page.goto('/status');
    expect((await statusResponse).status()).toBe(200);
    await expect(page.getByTestId('status-comptes-state')).toHaveText('Fonctionne', { timeout: 15000 });
    await expect(page.getByTestId('status-emails-state')).toHaveText('Indisponible');
    await expect(page.getByTestId('status-donnees-state')).toHaveText('À savoir');
    await expect(page.locator('[data-testid="status-last-checked"]')).toContainText('Dernière vérification :', { timeout: 15000 });
    await expect(page.locator('head meta[name="robots"]').last()).toHaveAttribute('content', /noindex,\s*nofollow/i);
    expect(await page.locator('body').innerText()).not.toMatch(/Data Quality|Ingestion Freshness|Open P0|Threshold/);
    expect(monitorCalls).toEqual([]);
  });

  test('renders KO state when monitor endpoints are degraded', async ({ page }) => {
    await mockStatusEndpoints(page, { dataQualityStatus: 503, ingestionStatus: 503 });
    await mockPublicStatus(page, 503);
    await page.goto('/status');
    await expect(page.getByTestId('status-error-banner')).toContainText('Impossible de vérifier', { timeout: 15000 });
    await expect(page.getByTestId('status-comptes-state')).toHaveCount(0);   // no invented state
  });
});
