// @ts-nocheck
/**
 * G14-CHAN (Part B) — Windows high-contrast / forced colours (WCAG 1.4.11, 1.4.1): emulated with `forced-colors: active`. Every icon-only control (a button
 * or link whose visible content is only an icon, named by aria-label / title / sr-only text) must keep a VISIBLE icon: its SVG strokes or fills follow the
 * forced text colour (currentColor), never a fixed colour or nothing; and the page must still pass axe (except color-contrast, which reads authored
 * colours the system replaces in this mode — checked by the normal run).
 */
import { test, expect } from '../e2e/fixtures.js';
import { axeFindings, open } from './checks.mjs';

test.use({ viewport: { width: 1280, height: 900 } });

const ROUTES = ['/', '/aides', '/annuaire', '/auth/login'];
for (const width of [1280, 375]) {
  for (const route of ROUTES) {
    test(`forced colours ${width}px ${route}: icon-only controls stay visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ forcedColors: 'active' });
      await open(page, route, 'fr');
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'emulation active').toBe(true);
      const bad = await page.evaluate(() => {
        const visible = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
        const textOf = (e) => [...e.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !n.matches('svg, .sr-only, [aria-hidden="true"]') ? n.textContent : '')).join('').trim();
        const out = [];
        for (const c of document.querySelectorAll('button, a[href], [role="button"]')) {
          if (!visible(c) || textOf(c)) continue;
          const svgs = [...c.querySelectorAll('svg')].filter(visible); const imgs = [...c.querySelectorAll('img')].filter(visible);
          if (!svgs.length && !imgs.length) continue;   // not an icon control (e.g. a CSS-drawn control)
          if (imgs.length && !svgs.length) continue;      // an image keeps its pixels in forced colours
          const color = getComputedStyle(c).color;
          const ok = svgs.some((s) => [s, ...s.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')].some((p) => {
            const cs = getComputedStyle(p); return (cs.stroke !== 'none' && cs.stroke === color && parseFloat(cs.strokeWidth) > 0) || (cs.fill !== 'none' && cs.fill === color); }));
          if (!ok) out.push(`${c.tagName} « ${c.getAttribute('aria-label') || c.getAttribute('title') || c.className.toString().slice(0, 30)} » icon not in the forced text colour`);
        }
        return out.slice(0, 8);
      });
      expect(bad, 'icon-only controls').toEqual([]);
      expect(await axeFindings(page, { forcedColors: true }), 'axe in forced colours (color-contrast excepted: system colours)').toEqual([]);
    });
  }
}
