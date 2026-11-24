/**
 * UI modernisation — a foldable held open (two screens, vertical hinge) emulated with the Chrome DevTools display-feature override, the way Chrome
 * reports viewport segments: checks that the two columns of .ada-fold-split each stay inside one segment (nothing under the hinge) and takes screenshots.
 *   UI_BASE=http://127.0.0.1:5191 UI_SHOTS=<dir> node e2e-ui/ui-fold.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5191';
if (/:3000\b/.test(BASE)) throw new Error('ui-fold: port 3000 is the owner LAB');
const OUT = process.env.UI_SHOTS || 'ui-shots';
fs.mkdirSync(OUT, { recursive: true });
const W = 1114; const H = 705; const HINGE = 28; const LEFT = (W - HINGE) / 2;   // two 543 px screens around a 28 px hinge
const browser = await chromium.launch({ channel: process.env.UI_CHANNEL || 'chrome' });
let bad = 0;
for (const p of ['/compte', '/compte/parametres']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ada_onboarding_done', 'true'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false, displayFeature: { orientation: 'vertical', offset: LEFT, maskLength: HINGE } });
  await page.goto(BASE + p, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ada-fold-split', { timeout: 20000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const segs = matchMedia('(horizontal-viewport-segments: 2)').matches;
    const kids = [...document.querySelector('.ada-fold-split').children].filter((k) => k.offsetParent !== null).map((k) => { const b = k.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; });
    return { segs, kids };
  });
  const crosses = r.kids.filter(([l, rr]) => l < LEFT + HINGE && rr > LEFT);
  console.log(`${p}: segments=${r.segs} columns=${JSON.stringify(r.kids)} hinge=[${LEFT}, ${LEFT + HINGE}] ${crosses.length ? '✗ crosses the hinge' : '✓'}`);
  if (!r.segs || crosses.length) bad += 1;
  await page.screenshot({ path: path.join(OUT, `fold-open${p.replace(/\//g, '_')}.png`) });
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
