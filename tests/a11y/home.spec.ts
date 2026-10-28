import { test } from '@playwright/test';
import { expectNoA11yIssues } from './a11y.utils';

test('Home page should have no critical or serious accessibility issues', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { state: 'attached' });
    await expectNoA11yIssues(page);
});
