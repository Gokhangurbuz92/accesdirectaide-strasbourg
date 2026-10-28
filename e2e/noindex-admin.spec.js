import { test, expect } from './fixtures.js';

test.describe('P7-D Indexability', () => {
  test('/admin/login exposes robots noindex', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.locator('head meta[name="robots"]').last()).toHaveAttribute(
      'content',
      /noindex,\s*nofollow/i,
    );
  });
});

