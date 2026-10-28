import { test, expect } from '@playwright/test';
import { expectNoA11yIssues } from './a11y.utils';

test.describe('Navigation a11y — Header links + focus-visible', () => {
    test('header navigation contains accessible links', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('header', { state: 'attached' });

        // Verify at least 3 links exist in the header area
        const headerLinks = page.locator('header').getByRole('link');
        const linkCount = await headerLinks.count();
        expect(linkCount, 'Header should contain at least 3 links').toBeGreaterThanOrEqual(3);

        // Verify key navigation labels are present (role-based selectors)
        const expectedLabels = ['Accueil', 'Aides', 'Démarches'];
        for (const label of expectedLabels) {
            const link = page.locator('header').getByRole('link', { name: label }).first();
            await expect(
                link,
                `Header should contain a link with label "${label}"`,
            ).toBeVisible();
        }
    });

    test('keyboard focus reaches header links with visible indicator', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('header', { state: 'attached' });

        const focusedElements: Array<{ tag: string; text: string; hasFocusIndicator: boolean }> = [];

        // Tab through the page — header links/buttons should be in natural tab order
        for (let i = 0; i < 15; i++) {
            await page.keyboard.press('Tab');
            // Small wait for focus styles to apply
            await page.waitForTimeout(50);

            const focusInfo = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) {
                    return null;
                }

                const tag = el.tagName.toLowerCase();
                // Only care about interactive elements
                if (tag !== 'a' && tag !== 'button') return null;

                // Check if element is within the header
                if (!el.closest('header')) return null;

                const text = (el.textContent || '').trim().substring(0, 30);

                // Check focus indicator via computed styles
                // Tailwind ring utility uses box-shadow; browser focus uses outline
                const style = window.getComputedStyle(el);
                const hasOutline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
                const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
                const hasFocusIndicator = hasOutline || hasBoxShadow;

                return { tag, text, hasFocusIndicator };
            });

            if (focusInfo) {
                focusedElements.push(focusInfo);
            }
        }

        // Verify: at least 3 interactive header elements received focus
        expect(
            focusedElements.length,
            `At least 3 header links/buttons should receive keyboard focus, got ${focusedElements.length}: [${focusedElements.map((e) => e.text).join(', ')}]`,
        ).toBeGreaterThanOrEqual(3);

        // Verify: every focused element had a visible focus indicator
        const withoutIndicator = focusedElements.filter((e) => !e.hasFocusIndicator);
        expect(
            withoutIndicator.length,
            `All focused header elements should have a visible focus indicator (outline or box-shadow). Missing on: [${withoutIndicator.map((e) => e.text).join(', ')}]`,
        ).toBe(0);
    });

    test('no critical/serious a11y violations on Home page (Axe)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('header', { state: 'attached' });
        await expectNoA11yIssues(page);
    });

    test('mobile: header navigation accessible via hamburger menu', async ({ page }) => {
        // Set mobile viewport BEFORE navigating
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('header', { state: 'attached', timeout: 15000 });

        // Find and click the mobile menu toggle button
        const menuButton = page.locator('header').getByRole('button', { name: /menu|ouvrir/i });
        await expect(menuButton).toBeVisible({ timeout: 10000 });
        await menuButton.click();

        // Wait for mobile nav to appear
        await expect(page.locator('header nav')).toBeVisible({ timeout: 5000 });

        // Verify at least one navigation link became visible after opening menu
        // The mobile nav renders links that were previously hidden
        const mobileNavLinks = page.locator('header nav[aria-label*="mobile" i] a, header nav[aria-label*="Mobile" i] a');
        const visibleCount = await mobileNavLinks.count();
        expect(
            visibleCount,
            'Mobile menu should show navigation links after opening',
        ).toBeGreaterThanOrEqual(1);

        // Verify a specific nav item is visible (Accueil)
        const accueilLink = mobileNavLinks.filter({ hasText: 'Accueil' });
        await expect(accueilLink.first()).toBeVisible();

        // Run Axe on mobile view with menu open
        await expectNoA11yIssues(page);
    });
});
