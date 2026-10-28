
import { test, expect } from './fixtures.js';

test('CP1ter: Header Semantics Audit', async ({ page }) => {
    // Go to home
    await page.goto('/');

    // Check 'Aides' in the header (Desktop)
    // We use a locator that finds the text 'Aides' inside the nav
    const aidesItem = page.locator('nav').getByText('Aides', { exact: true });

    // In the current implementation (Button), this might be inside a button
    // We want to check if the clickable element is an <A> tag

    // Locate the specific element that has the text 'Aides' and is a direct child of the nav item structure
    // The structure is nav > div > button (contains 'Aides')
    const aidesButtonOrLink = page.locator('nav div.group > button, nav div.group > a').filter({ hasText: /^Aides$/ }).first();

    await expect(aidesButtonOrLink).toBeVisible();

    const tagName = await aidesButtonOrLink.evaluate(el => el.tagName);
    console.log(`Current Tag for Aides: ${tagName}`);

    // The goal is for this to be 'A'
    expect(tagName).toBe('A');

    // Check href is correct
    const href = await aidesButtonOrLink.getAttribute('href');
    expect(href).toMatch(/\/aides$/);

    // Take screenshot for proof
    // Highlighting the element to make it look like "inspector" selection
    await aidesButtonOrLink.evaluate(el => el.style.border = '2px solid red');
    await page.screenshot({ path: 'release/v1.0.0/proofs/01-nav/header-link-evidence.png' });
});
