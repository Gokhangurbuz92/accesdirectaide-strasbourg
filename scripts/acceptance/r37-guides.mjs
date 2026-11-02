#!/usr/bin/env node
/**
 * R37 — is every published official guide really there for a visitor? Read-only, on the public site only (no database).
 *   node scripts/acceptance/r37-guides.mjs [base] [--out result.json] [--no-browser] [--published-from <ISO instant>]
 * Per guide: in the public list (all categories), detail API by path and by ?slug=, title and official text present, the Service-Public sheet id
 * recoverable from the slug, the source URL and the provenance, then the real page in a browser (title in the h1, official provenance block, the
 * link to service-public.gouv.fr, no 404/503, lang="fr" on the French text when the interface is in another language). The R36 batch must give
 * exactly 33 guides, the earlier ones must not have been touched by the R36 publication (updatedAt before it).
 */
import fs from 'node:fs';
import { R36_ADDITIONS } from '../official-guides.mjs';

const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const browserOn = !process.argv.includes('--no-browser');
const LANGS = (process.env.LANGS || 'fr,en,tr,ar,de,uk').split(',');
const R36_PUBLISHED_FROM = process.argv.includes('--published-from') ? process.argv[process.argv.indexOf('--published-from') + 1] : '2026-11-02T15:30:00Z';   // the owner's R36 publication ran after this instant
const sheetOf = (slug) => (/-(f\d+)$/i.exec(String(slug)) || [])[1]?.toUpperCase() || null;
const getJson = async (u) => { const r = await fetch(base + u); return { status: r.status, body: await r.json().catch(() => null) }; };

const facets = (await getJson('/api/guides/facets')).body;
const all = new Map();
for (const c of facets.categories) for (const g of (await getJson(`/api/guides?categorie=${encodeURIComponent(c)}`)).body) all.set(g.slug, g);
const unfiltered = (await getJson('/api/guides')).body;
const guides = [...all.values()];
const rows = [];
for (const g of guides) {
  const sheet = sheetOf(g.slug); const r36 = R36_ADDITIONS.includes(sheet);
  const byPath = await getJson(`/api/guides/${encodeURIComponent(g.slug)}`); const byQuery = await getJson(`/api/guides?slug=${encodeURIComponent(g.slug)}`);
  const c = typeof byQuery.body?.contenu_json === 'string' ? JSON.parse(byQuery.body.contenu_json) : byQuery.body?.contenu_json;
  const checks = {
    detailPath: byPath.status === 200 && byPath.body?.slug === g.slug,
    detailQuery: byQuery.status === 200 && byQuery.body?.statut === 'publie',
    title: Boolean(byQuery.body?.titre?.trim()),
    officialText: c?.version === 'official-sheet-v1' && Array.isArray(c.steps) && c.steps.length > 0 && c.steps.every((s) => s.titre || s.texte),
    sheetId: Boolean(sheet) && (g.sources_urls || []).some((u) => u.endsWith(`/${sheet}`)) && String(c?.provenance?.sourceUrl || '').endsWith(`/${sheet}`),
    provenance: Boolean(c?.provenance?.checkedAt) && /service-public\.(gouv\.)?fr/.test(String(c?.provenance?.sourceUrl)),
    inUnfilteredList: unfiltered.some((x) => x.slug === g.slug),
    untouchedByR36: r36 || new Date(g.updatedAt) < new Date(R36_PUBLISHED_FROM),
  };
  rows.push({ slug: g.slug, sheet, batch: r36 ? 'R36' : 'earlier', titre: g.titre, categorie: g.categorie, updatedAt: g.updatedAt, chapitres: c?.steps?.length || 0, checks, browser: {} });
}

if (browserOn) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: lang === 'fr' ? 1280 : 390, height: 900 }, locale: lang });
    await ctx.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } }, lang);
    const page = await ctx.newPage();
    // every guide in French (desktop); in the other languages the R36 batch only (phone width), to keep the run short and polite
    for (const row of rows.filter((x) => lang === 'fr' || x.batch === 'R36')) {
      const resp = await page.goto(`${base}/bonnes-pratiques/${row.slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-testid="guide-detail"], h1', { timeout: 20000 }).catch(() => {});
      await page.waitForSelector('[data-testid="guide-detail"]', { timeout: 8000 }).catch(() => {});
      const v = await page.evaluate(() => {
        const h1 = document.querySelector('h1'); const art = document.querySelector('[data-testid="guide-detail"]');
        const fr = h1?.querySelector('[lang="fr"]') || h1?.closest('[lang="fr"]');
        return { h1: h1?.textContent?.trim() || '', article: Boolean(art), steps: document.querySelectorAll('[data-testid="guide-step"]').length,
          provenance: Boolean(document.querySelector('[data-testid="guide-official-provenance"] a[href*="service-public"]')),
          htmlLang: document.documentElement.lang, dir: document.documentElement.dir, titleLangFr: Boolean(fr), notFound: /introuvable|404/i.test(h1?.textContent || '') };
      });
      const ok = resp?.status() === 200 && v.article && v.h1.includes(row.titre.slice(0, 30)) && v.steps === row.chapitres && v.provenance && !v.notFound
        && (lang === 'fr' || v.titleLangFr) && (lang !== 'ar' || v.dir === 'rtl');
      row.browser[lang] = ok ? 'PASS' : `FAIL ${JSON.stringify({ http: resp?.status(), ...v })}`.slice(0, 300);
    }
    await ctx.close();
  }
  await browser.close();
}

for (const r of rows) r.pass = Object.values(r.checks).every(Boolean) && Object.values(r.browser).every((x) => x === 'PASS');
const r36 = rows.filter((r) => r.batch === 'R36'); const earlier = rows.filter((r) => r.batch === 'earlier');
const summary = {
  base, at: new Date().toISOString(), published: rows.length, unfilteredListLength: unfiltered.length,
  r36: { expected: R36_ADDITIONS.length, found: r36.length, missing: R36_ADDITIONS.filter((id) => !r36.some((r) => r.sheet === id)), pass: r36.filter((r) => r.pass).length },
  earlier: { found: earlier.length, pass: earlier.filter((r) => r.pass).length },
  failures: rows.filter((r) => !r.pass).map((r) => ({ slug: r.slug, checks: Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k), browser: Object.entries(r.browser).filter(([, v]) => v !== 'PASS') })),
};
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.batch.padEnd(7)} ${r.sheet} ${r.slug}${r.pass ? '' : ' ' + JSON.stringify(summary.failures.find((f) => f.slug === r.slug))}`);
console.log(`R37_GUIDES ${JSON.stringify({ ...summary, failures: summary.failures.length })}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.failures.length || summary.r36.found !== summary.r36.expected ? 1 : 0);
