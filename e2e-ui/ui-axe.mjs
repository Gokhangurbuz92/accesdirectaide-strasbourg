/**
 * UI modernisation — axe (WCAG 2.1 A/AA, serious + critical) on the redesigned citizen screens: light and dark theme, high contrast, French and Arabic
 * (RTL), 320 px and 1280 px, plus a sideways-scroll check. Same synthetic mock API as e2e-ui/ui-shots.mjs (UI_BASE; never :3000).
 *   UI_BASE=http://127.0.0.1:5191 node e2e-ui/ui-axe.mjs     → exit 1 on any finding
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5191';
if (/:3000\b/.test(BASE)) throw new Error('ui-axe: port 3000 is the owner LAB');
const PAGES = [['/compte', '[data-testid="mon-espace"]'], ['/compte/parametres', 'h1', /Données|البيانات/], ['/compte/parametres', 'h1', /Accessibilit|إمكانية/], ['/compte/parametres', 'h1'], ['/compte/entraide', 'h1'], ['/', 'h1']];
if (process.env.UI_SET === 'pro') {
  PAGES.length = 0;
  for (const x of ['dashboard', 'team', 'audit', 'reports', 'structure', 'rdv/agenda', 'rdv/new', 'rdv/services', 'rdv/disponibilites', 'rdv/absences', 'messages', 'regional', 'parametres']) PAGES.push([`/pro/${x}`, 'main h1']);
}
const MODES = [
  { theme: 'light', lang: 'fr', w: 1280 }, { theme: 'dark', lang: 'fr', w: 1280 }, { theme: 'light', lang: 'ar', w: 320 },
  { theme: 'dark', lang: 'ar', w: 320 }, { theme: 'light', lang: 'fr', w: 320, hc: true },
];
let bad = 0;
const browser = await chromium.launch({ channel: process.env.UI_CHANNEL || 'chrome' });
for (const m of MODES) {
  for (const [p, wait, tab] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: m.w, height: 900 }, colorScheme: m.theme, serviceWorkers: 'block' });
    await ctx.addInitScript((mm) => {
      try {
        localStorage.setItem('ada_onboarding_done', 'true');
        localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() }));
        localStorage.setItem('ada-theme', mm.theme); localStorage.setItem('pro_token', 'synthetic-fixture-token'); localStorage.setItem('ada_lang', mm.lang);
        if (mm.hc) localStorage.setItem('accessibilitySettings', JSON.stringify({ contrast: 'high' }));
      } catch { /* */ }
    }, m);
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForSelector(wait, { timeout: 20000 }).catch(() => {});
    if (m.hc) await page.evaluate(() => { document.documentElement.classList.add('high-contrast'); document.body.classList.add('high-contrast'); });
    if (tab) await page.getByRole('tab', { name: tab }).click().catch(() => { bad += 1; console.log(`TAB NOT FOUND ${tab} ${p}`); });
    await page.waitForTimeout(500);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const v = r.violations.filter((x) => ['serious', 'critical'].includes(x.impact));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const label = `${p}${tab ? ` [${tab.source}]` : ''} ${m.theme}${m.hc ? '+hc' : ''} ${m.lang} ${m.w}px`;
    if (v.length || over > 1) {
      bad += v.length + (over > 1 ? 1 : 0);
      console.log(`✗ ${label}${over > 1 ? ` overflow ${over}px` : ''}`);
      for (const x of v) console.log(`   ${x.id} (${x.impact}): ${x.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.failureSummary || '').split('\n')[1] || ''}`).join(' | ')}`);
    } else console.log(`✓ ${label}`);
    await ctx.close();
  }
}
await browser.close();
console.log(bad ? `${bad} finding(s)` : 'no serious/critical finding');
process.exit(bad ? 1 : 0);
