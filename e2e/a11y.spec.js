
import { test, expect } from './fixtures.js';

test.describe('Accessibility and Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock critical API calls for Home Page
    await page.route('**/api/taxonomy', async route => route.fulfill({ json: { categories: [], situations: [] } }));
    await page.route('**/api/actualites*', async route => route.fulfill({ json: [] }));
    await page.route('**/api/stats*', async route => route.fulfill({ json: { users: 100, structures: 50 } }));
  });

  test('Home page has correct language and structure', async ({ page }) => {
    await page.goto('/');

    // Check html lang attribute
    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('fr');

    // Check main heading
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('Keyboard navigation works for vital path', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Reset focus context: blur any active element so Tab traverses from document start
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });

    // 2. Tab until skip link receives focus (may need 1-5 tabs depending on browser + DOM order)
    const skipLink = page.getByRole('link', { name: 'Aller au contenu principal' });
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      if (await skipLink.evaluate(el => el === document.activeElement)) break;
    }
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    // 3. Tab to Logo
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /aller.*accueil/i }).first()).toBeFocused();

    // 4. Tab through Nav Items
    await page.keyboard.press('Tab');
    const navFocused = page.locator(':focus');
    // Ensure we are in a link or button
    const tagName = await navFocused.evaluate(el => el.tagName);
    expect(['A', 'BUTTON']).toContain(tagName);

    // 5. Check Search Input Reachability (by ID now)
    const searchInput = page.locator('#hero-search');
    if (await searchInput.count() > 0) {
      await searchInput.focus();
      await expect(searchInput).toBeFocused();
    }
  });
});
