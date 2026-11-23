// @ts-nocheck
/**
 * G14-CHAN (Part B) — the CI slice of the FA-D4 RGAA audit (e2e-r47/rgaa/rgaa-audit.pw.mjs) on the public sample, against the mocked `vite preview`:
 * axe (WCAG 2.0 / 2.1 / 2.2 A + AA + best practices, every impact), keyboard-only walk, reflow at 320 px, 400 % zoom (320 × 256), text spacing,
 * reduced motion, and lang / dir in French, English and Arabic (right-to-left). Every finding FAILS (unlike the LAB audit, which reports).
 */
import { test, expect } from '../e2e/fixtures.js';
import { SAMPLE, axeFindings, keyboardWalk, langDirFindings, layoutFindings, open, overflowX, reducedMotionFindings } from './checks.mjs';

test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });

for (const route of SAMPLE) {
  test(`fr ${route} — axe, keyboard, reflow / zoom 400 % / text spacing, reduced motion`, async ({ page }) => {
    const resp = await open(page, route, 'fr');
    expect(resp?.status() ?? 0, 'reachable').toBeLessThan(500);
    expect(await axeFindings(page), 'axe').toEqual([]);
    expect(await reducedMotionFindings(page), 'reduced motion').toEqual([]);
    expect(await keyboardWalk(page), 'keyboard').toEqual([]);
    expect(await layoutFindings(page), 'layout').toEqual([]);
  });
}

for (const lang of ['fr', 'en', 'ar']) {
  for (const route of ['/', '/aides', '/auth/login']) {
    test(`${lang} ${route} — lang / dir${lang === 'ar' ? ', RTL alignment, axe, reflow 320' : ''}`, async ({ page }) => {
      await open(page, route, lang);
      expect(await langDirFindings(page, lang), 'lang/dir').toEqual([]);
      if (lang === 'ar') {
        expect(await axeFindings(page), 'axe (ar)').toEqual([]);
        await page.setViewportSize({ width: 320, height: 800 }); await page.waitForTimeout(250);
        expect(await overflowX(page), 'reflow 320 (ar)').toBeLessThanOrEqual(1);
      }
    });
  }
}
