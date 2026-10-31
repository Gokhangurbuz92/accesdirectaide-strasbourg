// R31 — production acceptance, anonymous and read-only: every public route of the route inventory (src/pages/index.jsx) on desktop and phone.
// Per page: document status, page errors, failed same-origin requests, an h1, visible main text, broken tokens, horizontal scroll (phone), axe serious/critical
// (desktop). Plus the closed-feature pages: what a visitor actually sees during the beta.
import fs from 'node:fs';
import { chromium } from 'playwright';
const BASE = (process.argv[2] || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const OUT = process.argv[3] || '/dev/null';
const axeSrc = fs.readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const j = async (p) => (await fetch(`${BASE}/api/${p}`)).json();
const first = (d) => (Array.isArray(d) ? d : d.items || [])[0]?.slug;
const slugs = {
  aide: first(await j('aides?limit=1')), demarche: first(await j('demarches?limit=1')), structure: first(await j('structures?limit=1')),
  actualite: first(await j('actualites?limit=1')), guide: first(await j('guides?limit=1')), dispositif: first(await j('dispositifs?limit=1')),
};
const ROUTES = [
  '/', '/aides', `/aides/${slugs.aide}`, '/aides/theme/logement', '/demarches', `/demarches/${slugs.demarche}`, '/structures', `/structures/${slugs.structure}`,
  '/dispositifs', `/dispositifs/${slugs.dispositif}`, '/actualites', `/actualites/${slugs.actualite}`, '/bonnes-pratiques', `/bonnes-pratiques/${slugs.guide}`,
  '/outils', '/ressources', '/glossaire', '/recherche?q=logement%20social', '/categories/logement', '/trouver-aide', '/territoire',
  '/notre-mission', '/notre-methode', '/sources', '/a-propos', '/impact', '/partenaires', '/status', '/accessibilite', '/securite-et-rgpd',
  '/mentions-legales', '/confidentialite', '/cookies', '/cgu', '/contact',
  // features closed during the beta: the page must say so plainly, never fail
  '/diagnostic', '/orientation', '/assistant', '/demande-aide', '/auth/login', '/auth/signup', '/login/pro', '/appointments/request',
];
const BROKEN = /\bundefined\b|\bNaN\b|\[object Object\]|Lorem ipsum|\{\{|\bnull\b(?! ?(et|ou)\b)/;
const results = [];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 375, height: 812 }]]) {
  const ctx = await browser.newContext({ viewport, locale: 'fr-FR' });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const errors = []; const failed = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160)));
    page.on('response', (r) => { const u = r.url(); if (u.startsWith(BASE) && r.status() >= 400) failed.push(`${r.status()} ${u.replace(BASE, '')}`); });
    let status = 0;
    try { status = (await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45000 }))?.status() || 0; } catch (e) { errors.push(`goto: ${e.message.slice(0, 120)}`); }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);   // entrance animations settle (contrast is measured at rest)
    const info = await page.evaluate((re) => {
      const main = document.querySelector('main') || document.body;
      const text = (main.innerText || '').trim();
      return { h1: document.querySelectorAll('h1').length, title: document.title, text: text.length, broken: (text.match(new RegExp(re)) || [])[0] || null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, closedNotice: /bêta|pas encore ouvert|n’est pas encore ouverte|fermé/i.test(text), sample: text.slice(0, 140) };
    }, BROKEN.source).catch(() => ({}));
    let axe = [];
    if (label === 'desktop') {
      try { await page.evaluate(axeSrc); axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}(${v.nodes.length})`)); } catch (e) { axe = [`axe-error ${e.message.slice(0, 60)}`]; }
    }
    const problems = [];
    if (status !== 200) problems.push(`status ${status}`);
    if (errors.length) problems.push(`page errors: ${errors.join(' | ')}`);
    if (failed.length) problems.push(`failed requests: ${[...new Set(failed)].slice(0, 4).join(', ')}`);
    if (!info.h1) problems.push('no h1');
    if ((info.text || 0) < 120) problems.push(`almost empty (${info.text} chars)`);
    if (info.broken) problems.push(`broken token « ${info.broken} »`);
    if (label === 'phone' && info.overflow > 1) problems.push(`horizontal scroll ${info.overflow}px`);
    if (axe.length) problems.push(`axe ${axe.join(' ')}`);
    results.push({ viewport: label, route, status, h1: info.h1, chars: info.text, closedNotice: info.closedNotice, problems, sample: info.sample });
    console.log(`${problems.length ? 'ISSUE' : 'OK   '} ${label.padEnd(7)} ${route}${problems.length ? ` — ${problems.join(' ; ')}` : ''}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
const issues = results.filter((r) => r.problems.length);
console.log(`R31_PROD_ACCEPT ${JSON.stringify({ base: BASE, pages: results.length, ok: results.length - issues.length, issues: issues.length, slugs })}`);
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), slugs, results }, null, 2));
