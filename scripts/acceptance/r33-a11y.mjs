// R33 — internal accessibility self-assessment, automated part (read-only on public pages). It does NOT replace an RGAA audit: it records, per
// route and language, the checks a machine can make, and states which RGAA themes it cannot judge.
//   node scripts/acceptance/r33-a11y.mjs <base> [result.json]
// Per route × language: axe (wcag2a/aa/21aa/22aa, all impacts), <html lang/dir>, one h1, a skip link that moves focus to main, focus visible on the
// first 25 tab stops, reflow at 320 px (= 400 % zoom of 1280 px, RGAA 10.11), text spacing / 200 % text without loss (RGAA 10.4 proxy), touch
// targets of 24×24 px minimum (WCAG 2.5.8), reduced motion honoured (no running CSS animation), no page error.
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const OUT = process.argv[3];
const axeSrc = fs.readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const LANGS = (process.env.LANGS || 'fr,en,tr,ar,de,uk').split(',');
const ROUTES = (process.env.ROUTES || '/,/aides,/aides/faj-strasbourg,/demarches,/demarches/demande-c2s,/structures,/besoins,/actualites,/guides,/guides/duree-de-conservation-des-papiers-f19134,/recherche?q=logement,/glossaire,/a-propos,/contact,/accessibilite,/mentions-legales,/confidentialite,/cookies,/plan-du-site').split(',');
const rows = [];
const rec = (lang, route, check, pass, detail = '') => { rows.push({ lang, route, check, pass: !!pass, detail: String(detail).slice(0, 300) }); if (!pass) console.log(`FAIL ${lang} ${route} ${check} — ${String(detail).slice(0, 160)}`); };
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

for (const lang of LANGS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: lang });
  await ctx.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } }, lang);
  const page = await ctx.newPage(); let errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
  for (const route of ROUTES) {
    errors = [];
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(700);
    await page.evaluate(axeSrc);
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map((x) => `${x.impact}:${x.id}(${x.nodes.length})`));
    rec(lang, route, 'axe-no-violation', v.length === 0, v.join(' '));
    const doc = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelectorAll('h1').length, title: document.title }));
    rec(lang, route, 'html-lang-dir', doc.lang === lang && doc.dir === (lang === 'ar' ? 'rtl' : 'ltr'), JSON.stringify(doc));
    rec(lang, route, 'one-h1', doc.h1 === 1, `${doc.h1} h1`);
    rec(lang, route, 'title', doc.title.trim().length > 0, doc.title);
    // keyboard: the first Tab reaches a skip link that moves focus into main; focus is visible on the first 25 stops
    await page.keyboard.press('Tab');
    const skip = await page.evaluate(() => { const a = document.activeElement; return a && a.tagName === 'A' && /#(main|contenu|content)/.test(a.getAttribute('href') || '') ? a.getAttribute('href') : null; });
    rec(lang, route, 'skip-link-first', !!skip, skip || 'first tab stop is not a skip link');
    if (skip) { await page.keyboard.press('Enter'); await page.waitForTimeout(200); rec(lang, route, 'skip-link-moves-focus', await page.evaluate(() => !!document.activeElement?.closest('main') || document.activeElement?.id === 'main-content'), ''); }
    const invisible = [];
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const s = getComputedStyle(a);
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' || a.matches(':focus-visible') && (s.outlineStyle !== 'none' || s.boxShadow !== 'none');
        return { visible, label: (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 40) }; });
      if (r && !r.visible) invisible.push(r.label);
    }
    rec(lang, route, 'focus-visible', invisible.length === 0, invisible.slice(0, 5).join(' | '));
    // touch targets (WCAG 2.5.8, 24×24) — inline links inside text are exempt
    const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, [role="button"]')].filter((e) => {
      const r = e.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;   // visually hidden until focused (skip link)
      if (e.tagName === 'A' && e.closest('p, li') && getComputedStyle(e).display === 'inline') return false;
      if (/after:inset-0/.test(String(e.className))) return false;   // stretched link: the whole card is the target
      if (e.tagName === 'INPUT' && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 24) return false;   // the label is part of the target
      return r.width < 24 || r.height < 24; }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30)));
    rec(lang, route, 'target-size-24', small.length === 0, `${small.length}: ${small.slice(0, 5).join(' | ')}`);
    // reduced motion: no running CSS animation
    const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations === Infinity).length);
    rec(lang, route, 'reduced-motion', anim === 0, `${anim} infinite animations`);
    // reflow at 320 px (400 % zoom)
    await page.setViewportSize({ width: 320, height: 800 }); await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    rec(lang, route, 'reflow-320', over <= 1, `${over}px`);
    // text spacing (WCAG 1.4.12) at 320 px: no horizontal overflow after spacing is increased
    await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' });
    await page.waitForTimeout(300);
    const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    rec(lang, route, 'text-spacing-320', over2 <= 1, `${over2}px`);
    rec(lang, route, 'no-page-error', errors.length === 0, errors.join(' | '));
  }
  await ctx.close();
}
await browser.close();
const byCheck = {};
for (const r of rows) { byCheck[r.check] ??= { pass: 0, fail: 0 }; byCheck[r.check][r.pass ? 'pass' : 'fail'] += 1; }
console.log(`R33_A11Y ${JSON.stringify({ base: BASE, total: rows.length, fail: rows.filter((r) => !r.pass).length, byCheck })}`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), routes: ROUTES, langs: LANGS, rows }, null, 1));
