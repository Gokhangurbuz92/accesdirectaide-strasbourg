#!/usr/bin/env node
/**
 * R37 — the FINESS authorised activities on the real public pages. Read-only, public site only.
 *   node scripts/acceptance/r37-finess-ui.mjs [base] [--out result.json]
 * 1. Counts through the public list API: FINESS records, records with activities, activity labels (the owner's production run: 701 / 589 / 1,032).
 * 2. One establishment per family of need (EHPAD, disability, home support, child protection, accommodation, addiction, medico-social): the page in six
 *    languages (French at desktop width, the others at 390 px) shows every activity under « Activités autorisées » with the no-guarantee notice, the
 *    labels marked lang="fr" outside French, Arabic right-to-left, no horizontal scroll at 390 px.
 * 3. The activities are searchable: the structure search on a word of an activity finds the establishment.
 */
import fs from 'node:fs';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const LANGS = (process.env.LANGS || 'fr,en,tr,ar,de,uk').split(',');
const HEADINGS = { fr: 'Activités autorisées', en: 'Authorised activities', tr: 'İzin verilen faaliyetler', ar: 'الأنشطة المرخَّص بها', de: 'Genehmigte Tätigkeiten', uk: 'Дозволені види діяльності' };
const FAMILIES = [['ehpad', /ehpad|hébergement pour personnes âgées/i], ['handicap', /handicap|foyer d'accueil médicalisé|maison d'accueil spécialisée|esat|ime\b|sessad/i],
  ['domicile', /domicile|ssiad/i], ['enfance', /enfance|mecs|maison d'enfants|pouponnière/i], ['hebergement', /chrs|hébergement et de réinsertion|pension de famille|résidence sociale|maison relais/i],
  ['addiction', /csapa|addictolog|caarud/i], ['medico-social', /médico-social|camsp|cmpp|lits halte/i]];
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { for (let k = 0; k < 6; k++) { const r = await fetch(base + u); if (r.ok) return r.json(); await sl(10000); } throw new Error(`HTTP error ${u}`); };

const all = []; for (let p = 1; ; p++) { const j = await get(`/api/structures?pageSize=50&page=${p}`); all.push(...j.items); if (!j.pagination.hasNext) break; await sl(1500); }
const finess = all.filter((s) => String(s.source_url || '').startsWith('https://finess.esante.gouv.fr/'));
const withActs = finess.filter((s) => Array.isArray(s.services) && s.services.length);
const counts = { structures: all.length, finess: finess.length, withActivities: withActs.length, labels: withActs.reduce((n, s) => n + s.services.length, 0), nonFinessWithServices: all.filter((s) => !finess.includes(s) && s.services?.length).length };
console.log(`COUNTS ${JSON.stringify(counts)}`);

await sl(60000);   // let the per-address rate limit window pass after paging the list
const picks = FAMILIES.map(([family, re]) => [family, withActs.find((s) => re.test(s.type_structure) || s.services.some((x) => re.test(x)))]).filter(([, s]) => s);
const rows = [];
const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
for (const lang of LANGS) {
  const width = lang === 'fr' ? 1280 : 390;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: lang });
  await ctx.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } }, lang);
  const page = await ctx.newPage();
  for (const [family, s] of picks) {
    // the public API is rate-limited per address: a page that could not load its record (429) is retried once after a pause, never counted as a pass
    let resp = await page.goto(`${base}/structures/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!(await page.waitForSelector('[data-testid="finess-activities"]', { timeout: 20000 }).catch(() => null))) {
      await sl(30000); resp = await page.goto(`${base}/structures/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-testid="finess-activities"]', { timeout: 20000 }).catch(() => {});
    }
    const v = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="finess-activities"]'); const card = box?.parentElement;
      return { heading: card?.querySelector('h2')?.textContent?.trim() || '', notice: Boolean(document.querySelector('[data-testid="finess-activities-notice"]')),
        labels: [...(box?.children || [])].map((x) => ({ text: x.textContent.trim(), lang: x.getAttribute('lang') || x.closest('[lang]')?.getAttribute('lang') })),
        dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, servicesHeading: [...document.querySelectorAll('h2')].some((h) => /Services proposés/.test(h.textContent)) };
    });
    const ok = resp?.status() === 200 && v.heading === HEADINGS[lang] && v.notice && v.labels.length === s.services.length && v.labels.every((l, i) => l.text === s.services[i])
      && (lang === 'fr' || v.labels.every((l) => l.lang === 'fr')) && (lang !== 'ar' || v.dir === 'rtl') && !v.overflow && !v.servicesHeading;
    rows.push({ lang, family, slug: s.slug, type: s.type_structure, activities: s.services.length, pass: ok, ...(ok ? {} : { got: { ...v, labels: v.labels.length } }) });
  }
  await ctx.close();
}
await browser.close();

// 3. searchable: a distinctive word of the first activity finds the establishment
const search = [];
for (const [family, s] of picks) {
  const word = (s.services[0].split(/[\s(),—-]+/).filter((w) => w.length > 6)[0] || s.services[0]).toLowerCase();
  const q = `${word} ${s.ville}`;
  await sl(2000);
  const j = await get(`/api/structures?q=${encodeURIComponent(q)}&pageSize=50`);
  search.push({ family, q, found: (j.items || []).some((x) => x.id === s.id), total: j.pagination?.total ?? null });
}
const summary = { base, at: new Date().toISOString(), counts, pages: { pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).length }, search: { pass: search.filter((x) => x.found).length, of: search.length } };
for (const r of rows.filter((x) => !x.pass)) console.log('FAIL', JSON.stringify(r));
for (const x of search) console.log(`${x.found ? 'PASS' : 'FAIL'} search « ${x.q} » (${x.family})`);
console.log(`R37_FINESS_UI ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, picks: picks.map(([f, s]) => ({ family: f, slug: s.slug, type: s.type_structure, services: s.services })), rows, search }, null, 2));
process.exit(summary.pages.fail || summary.search.pass < summary.search.of ? 1 : 0);
