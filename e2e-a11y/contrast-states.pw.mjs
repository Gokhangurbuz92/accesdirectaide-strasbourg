// @ts-nocheck
/**
 * G14-CHAN (Part B) — contrast in the HOVER and FOCUS states, which axe does not test (it reads the resting state):
 *   hover   the text of a link / button under the pointer keeps ≥ 4.5:1 with what is behind it (≥ 3:1 for large text: 24 px, or 18.66 px bold) — WCAG 1.4.3;
 *   focus   the keyboard focus indicator (outline, or a box-shadow ring) keeps ≥ 3:1 with the background next to it — WCAG 1.4.11 / 2.4.7 — and the text
 *           of the focused control keeps 1.4.3 too.
 * A control over an image or a gradient cannot be measured by script: it is skipped (counted), never assumed fine or failing.
 */
import { test, expect } from '../e2e/fixtures.js';
import { CONTRAST_SRC, open } from './checks.mjs';

test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const ROUTES = ['/', '/aides', '/annuaire', '/auth/login', '/contact'];
const MAX = 40;

const measure = (page, mode) => page.evaluate(({ src, mode }) => {
  const lib = new Function(`${src}; return { parse, over, ratio, bgOf };`)();
  const el = document.activeElement && mode === 'focus' ? document.activeElement : document.querySelector('[data-a11y-probe]');
  if (!el) return null;
  const cs = getComputedStyle(el); const bg = lib.bgOf(el); const fg = lib.parse(cs.color);
  const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
  const large = size >= 24 || (bold && size >= 18.66);
  const out = { label: `${el.tagName} « ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} »`, skipped: !bg, text: null, ring: null, large };
  if (!bg) return out;
  if ((el.textContent || '').trim() && fg) out.text = lib.ratio(lib.over(fg, bg), bg);
  if (mode === 'focus') {
    const parentBg = lib.bgOf(el.parentElement) || bg;
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) { const oc = lib.parse(cs.outlineColor); if (oc) out.ring = lib.ratio(lib.over(oc, parentBg), parentBg); }
    else if (cs.boxShadow && cs.boxShadow !== 'none') {
      const colours = [...cs.boxShadow.matchAll(/rgba?\([^)]+\)/g)].map((m) => lib.parse(m[0])).filter((c) => c && c.a > 0);
      if (colours.length) out.ring = Math.max(...colours.map((c) => lib.ratio(lib.over(c, parentBg), parentBg)));
    }
  }
  return out;
}, { src: CONTRAST_SRC, mode });

for (const route of ROUTES) {
  test(`hover and focus contrast ${route}`, async ({ page }) => {
    await open(page, route, 'fr');
    await page.addStyleTag({ content: '*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }' });
    const handles = await page.locator('main a[href]:visible, main button:visible, header a[href]:visible, header button:visible').all();
    const findings = []; let skipped = 0; let measured = 0;
    for (const h of handles.slice(0, MAX)) {
      if (!(await h.isVisible().catch(() => false))) continue;
      // hover
      await h.evaluate((e) => e.setAttribute('data-a11y-probe', '')).catch(() => {});
      await h.hover({ timeout: 2000 }).catch(() => {});
      const hv = await measure(page, 'hover');
      await h.evaluate((e) => e.removeAttribute('data-a11y-probe')).catch(() => {});
      if (hv?.skipped) skipped += 1;
      else if (hv?.text != null) { measured += 1; if (hv.text < (hv.large ? 3 : 4.5)) findings.push(`hover text ${hv.text.toFixed(2)}:1 ${hv.label}`); }
      // keyboard focus (focus() after a key press: :focus-visible applies as for a Tab)
      await page.mouse.move(0, 0);
      await page.keyboard.press('Shift');
      await h.focus().catch(() => {});
      const fv = await measure(page, 'focus');
      if (fv && !fv.skipped) {
        if (fv.ring != null && fv.ring < 3) findings.push(`focus indicator ${fv.ring.toFixed(2)}:1 ${fv.label}`);
        if (fv.text != null && fv.text < (fv.large ? 3 : 4.5)) findings.push(`focused text ${fv.text.toFixed(2)}:1 ${fv.label}`);
      }
    }
    test.info().annotations.push({ type: 'contrast', description: `${measured} measured, ${skipped} skipped (image / gradient behind)` });
    expect([...new Set(findings)], `contrast states on ${route}`).toEqual([]);
  });
}
