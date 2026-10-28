// @ts-check
import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';

/**
 * Phase 2 — Accessibility (RGAA 4.1.2) automated tests.
 *
 * Uses axe-core via @axe-core/playwright to scan key pages for
 * critical and serious accessibility violations.
 */

const PAGES = [
    { name: 'Accueil', path: '/' },
    { name: 'Aides', path: '/aides' },
    { name: 'Aide détail', path: '/aides/aide-test' },
    { name: 'Démarches', path: '/demarches' },
    { name: 'Annuaire', path: '/annuaire' },
    { name: 'Recherche', path: '/recherche' },
    { name: 'Orientation', path: '/orientation' },
    { name: 'Connexion', path: '/auth/login' },
];

/**
 * Route transitions fade the page in (opacity/color mid-animation), which makes axe
 * measure blended colors. Wait until computed opacities in the page stop changing.
 * @param {import('@playwright/test').Page} page
 */
async function waitForSettledPage(page) {
    await page.waitForFunction(() => {
        const sample = () =>
            Array.from(document.querySelectorAll('#main-content, #main-content *'))
                .map((el) => getComputedStyle(el).opacity)
                .join(',');
        // @ts-ignore — keep state across polls
        const w = window;
        const now = sample();
        const settled = w.__axeSettled && w.__axeSettled.value === now && Date.now() - w.__axeSettled.at > 400;
        if (!w.__axeSettled || w.__axeSettled.value !== now) w.__axeSettled = { value: now, at: Date.now() };
        return settled;
    }, null, { polling: 100, timeout: 10_000 });
}

test.describe('Accessibility — axe audit (critical + serious)', () => {
    for (const { name, path } of PAGES) {
        test(`${name} (${path}) — no critical/serious violations`, async ({ page }) => {
            // Augmentation du timeout pour la CI (PR #2)
            test.setTimeout(30_000);

            await page.goto(path);
            // Wait for main content to load (timeout étendu pour CI)
            await page.waitForSelector('#main-content', { state: 'visible', timeout: 15_000 });
            await waitForSettledPage(page);

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            // Filter to critical and serious only
            const serious = results.violations.filter(
                (v) => v.impact === 'critical' || v.impact === 'serious',
            );

            if (serious.length > 0) {
                const summary = serious
                    .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} instances)`)
                    .join('\n');
                console.error('Accessibility violations:\n' + summary);
            }

            expect(serious).toHaveLength(0);
        });
    }
});

test.describe('Accessibility — keyboard navigation', () => {
    test('Skip link is present and functional', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Reset focus context: blur any active element so Tab traverses from document start
        await page.evaluate(() => {
            if (document.activeElement && document.activeElement !== document.body) {
                /** @type {HTMLElement} */ (document.activeElement).blur();
            }
        });

        // Tab until skip link receives focus (may need more tabs due to header elements like DarkModeToggle)
        const skipLink = page.getByRole('link', { name: 'Aller au contenu principal' });
        for (let i = 0; i < 10; i++) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(50); // Small delay for focus to settle
            if (await skipLink.evaluate(el => el === document.activeElement)) break;
        }

        // Assert it received focus and became visible
        await expect(skipLink).toBeFocused({ timeout: 5000 });
        await expect(skipLink).toBeVisible();

        // Activate skip link
        await page.keyboard.press('Enter');

        // Check FOCUS moved to main content (requires tabindex="-1" on #main-content)
        const mainContent = page.locator('#main-content');
        await expect(mainContent).toBeFocused();
    });

    test('Chat widget — focus trap and Esc close', async ({ page }) => {
        await page.goto('/');

        // Find and click the chat FAB (Boussole Sociale)
        const chatFab = page.locator('button[aria-label*="Boussole"]');
        await chatFab.click();

        // Chat dialog should open with role="dialog"
        const chatDialog = page.locator('[role="dialog"]');
        await expect(chatDialog).toBeVisible();
        await expect(chatDialog).toHaveAttribute('aria-modal', 'true');

        // Input should be focused
        const chatInput = chatDialog.locator('input[aria-label="Message utilisateur"]');
        await expect(chatInput).toBeFocused();

        // Tab should cycle within the dialog (focus trap)
        await page.keyboard.press('Tab');
        // We should still be inside the dialog
        const activeElement = page.locator(':focus');
        const isInsideDialog = await chatDialog.locator(':focus').count();
        expect(isInsideDialog).toBeGreaterThan(0);

        // Esc should close the dialog
        await page.keyboard.press('Escape');
        await expect(chatDialog).not.toBeVisible();

        // Focus should return to the FAB
        await expect(chatFab).toBeFocused();
    });

    test('Wizard — progress bar has accessible role and value', async ({ page }) => {
        await page.goto('/orientation');

        const progressBar = page.locator('[role="progressbar"]');
        // Progress bar may or may not be visible depending on wizard state
        const count = await progressBar.count();
        if (count > 0) {
            await expect(progressBar).toHaveAttribute('aria-label', 'Progression du diagnostic');
            const valueText = await progressBar.getAttribute('aria-valuetext');
            expect(valueText).toMatch(/Étape \d+ sur \d+/);
        }
    });
});
