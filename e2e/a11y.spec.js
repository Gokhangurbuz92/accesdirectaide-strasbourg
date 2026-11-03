
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

    // 3. Tab to the logo. R41: since R32 (language offer, 906587f) and R36 (header utility row, 4623700) the controls ABOVE the logo come first, in the
    // visual order: the one-line language offer (only when the browser prefers another language) and the utility row (language, text size,
    // accessibility, theme, page reader). Every stop on the way must be one of those controls, the skip link is never revisited, and the logo is
    // reached within a bounded number of stops (the visible desktop logo, not the phone one).
    const logo = page.getByRole('link', { name: /aller.*accueil/i }).filter({ visible: true });
    await expect(logo).toHaveCount(1);
    const beforeLogo = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await logo.evaluate(el => el === document.activeElement)) break;
      beforeLogo.push(await page.evaluate(() => {
        const el = document.activeElement;
        const zone = el?.closest('[data-testid="language-suggestion"]') ? 'language-suggestion' : el?.closest('[data-testid="header-utilities"]') ? 'header-utilities' : 'other';
        return { zone, tag: el?.tagName || '', name: (el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 40) };
      }));
    }
    await expect(logo).toBeFocused();
    expect(beforeLogo.filter(s => s.zone === 'other'), 'only the language offer and the header utility row come before the logo').toEqual([]);
    expect(beforeLogo.map(s => s.zone), 'the language offer (when shown) comes before the utility row, as on screen')
      .toEqual([...beforeLogo.map(s => s.zone)].sort((a, b) => (a === b ? 0 : a === 'language-suggestion' ? -1 : 1)));
    expect(beforeLogo.some(s => s.zone === 'header-utilities'), 'the utility row is reachable by keyboard').toBe(true);

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
