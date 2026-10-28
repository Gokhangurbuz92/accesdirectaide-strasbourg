import { test, expect } from '@playwright/test';

test('Admin national page loads without crash', async ({ page }) => {
  // Mock login token in sessionStorage
  await page.goto('/login');
  await page.evaluate(() => {
    sessionStorage.setItem('access_token', 'fake-admin-token');
  });

  await page.route('/api/auth/me', async route => {
    const json = { user: { role: 'admin', id: 'admin1', firstName: 'Admin' } };
    await route.fulfill({ json });
  });

  await page.route('/api/admin/national-stats', async route => {
    const json = {
      summary: { totalAids: 10, activeStructures: 5, sharedDiagnostics: 2, activeAgents: 3 },
      territorial: [{ scope: 'national', count: 10 }],
      hive: [{ status: 'pending', count: 2 }]
    };
    await route.fulfill({ json });
  });

  await page.goto('/admin/national');
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  await page.waitForLoadState('networkidle');

  // Check if we see the Globe icon text "Pilotage National"
  await expect(page.locator('h1', { hasText: 'Pilotage National' })).toBeVisible();
});
