import { Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function expectNoA11yIssues(page: Page, options?: any) {
    // Dismiss the cookie banner before scanning to avoid false positives
    // (the banner is a dialog overlay that interferes with contrast checks)
    await page.evaluate(() => {
        if (!window.localStorage.getItem('ada_cookie_consent')) {
            window.localStorage.setItem('ada_cookie_consent', JSON.stringify({ accepted: true, date: new Date().toISOString() }));
        }
    });
    // Remove cookie banner from DOM if already rendered
    await page.evaluate(() => {
        const banner = document.getElementById('cookie-banner');
        if (banner) banner.remove();
    });

    // Wait for animations to settle — elements mid-animation (opacity: 0)
    // cause false-positive contrast violations in axe
    await page.waitForTimeout(500);
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; opacity: revert !important; }' });
    await page.waitForTimeout(100);

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    const filtered = accessibilityScanResults.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
    );

    if (filtered.length > 0) {
        console.error(`Found ${filtered.length} a11y violations (critical/serious):`);
        filtered.forEach((v) => {
            console.error(`- [${v.impact}] ${v.id}: ${v.description}`);
            v.nodes.forEach((node) => {
                console.error(`  - Target: ${node.target.join(', ')}`);
                console.error(`    Failure: ${node.failureSummary}`);
            });
        });
    }

    expect(filtered, "A11y violations (critical/serious)").toEqual([]);
}
