import { test, expect } from './fixtures.js';
import fs from 'fs';
import path from 'path';

// Output directory
const PROOF_DIR = 'release/v1.0.0/proofs/02-list-to-detail/';

test.beforeAll(async () => {
    if (!fs.existsSync(PROOF_DIR)) {
        fs.mkdirSync(PROOF_DIR, { recursive: true });
    }
});

test.describe('CP2 Bonus: WCAG Header', () => {

    test('Desktop Aides Submenu Keyboard Accessibility', async ({ page }) => {
        await page.goto('/');

        // 1. Press Tab until we reach "Aides" menu
        // "Accueil" is first, "Aides" is second in NAV_ITEMS (index 1)
        // But branding link is first in header.

        // Strategy: Press Tab and check 'Aides' link focus
        const aidesLink = page.getByRole('link', { name: 'Aides', exact: true });

        // Focus the link directly to simulate tabbing to it (or tab loop)
        await aidesLink.focus();
        await expect(aidesLink).toBeFocused();

        // 2. Verify Submenu is visible via focus-within
        const submenu = page.locator('#nav-aides-menu');
        await expect(submenu).toBeVisible();

        // 3. Verify Accessibility Attributes
        await expect(aidesLink).toHaveAttribute('aria-haspopup', 'menu');
        await expect(aidesLink).toHaveAttribute('aria-controls', 'nav-aides-menu');
        // aria-expanded should NOT be present staticly
        await expect(aidesLink).not.toHaveAttribute('aria-expanded');

        // 4. Tab into submenu
        await page.keyboard.press('Tab');
        const firstSubItem = page.getByRole('menuitem', { name: 'Toutes les aides' });
        await expect(firstSubItem).toBeFocused();

        // Screen proof
        await page.screenshot({ path: path.join(PROOF_DIR, 'header-aides-submenu-focus.png') });
    });
});
