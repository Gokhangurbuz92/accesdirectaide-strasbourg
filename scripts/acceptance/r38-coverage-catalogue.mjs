#!/usr/bin/env node
/**
 * R38 — the published catalogue, from the PUBLIC API only (read-only, paced), in the cache layout scripts/social-coverage.mjs reads (--cache <dir>):
 *   node scripts/acceptance/r38-coverage-catalogue.mjs [base] --out <dir> [--services-ids <previous services_externes.json>]
 * aide / demarche / actualite / structures: every page of the list (50 a page, never a truncated first page); dispositif: the list; guide: every category of
 * /api/guides/facets, then each guide's detail (?slug=) for its official text (contenu_json). services_externes.json: the data·inclusion attributions the
 * public detail API exposes, fetched again for the structures of --services-ids (the R35 candidates), so nothing is copied from an older run.
 * The run fails rather than writing a partial catalogue (a page that keeps answering an error stops it).
 */
import fs from 'node:fs';
import path from 'node:path';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const arg = (n) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : null);
const out = arg('out'); if (!out) throw new Error('--out <dir> is required');
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) {
  for (let k = 0; k < 6; k++) { const r = await fetch(base + u); if (r.ok) return r.json(); await sl(r.status === 429 ? 30000 : 5000); }
  throw new Error(`HTTP error on ${u}`);
}
async function paged(p) {
  const items = [];
  for (let page = 1; ; page++) { const j = await get(`${p}${p.includes('?') ? '&' : '?'}pageSize=50&page=${page}`); items.push(...(j.items || [])); if (!j.pagination?.hasNext) break; await sl(1500); }
  return items;
}
fs.mkdirSync(out, { recursive: true });
const write = (name, data) => { fs.writeFileSync(path.join(out, name), JSON.stringify(data)); console.log(`${name} ${Array.isArray(data) ? data.length : ''}`); };
const counts = {};
for (const [name, p] of [['aide', '/api/aides'], ['demarche', '/api/demarches'], ['actualite', '/api/actualites'], ['structures', '/api/structures']]) {
  const items = await paged(p); counts[name] = items.length; write(`${name}.json`, items); await sl(5000);
}
const disp = await get('/api/dispositifs'); const dispositifs = Array.isArray(disp) ? disp : disp.items || []; counts.dispositif = dispositifs.length; write('dispositif.json', dispositifs);
const facets = await get('/api/guides/facets'); const slugs = new Set();
for (const c of facets.categories) { for (const g of await get(`/api/guides?categorie=${encodeURIComponent(c)}`)) slugs.add(g.slug); await sl(1500); }
const guides = [];
for (const s of slugs) { guides.push(await get(`/api/guides?slug=${encodeURIComponent(s)}`)); await sl(1200); }
counts.guide = guides.length; write('guide.json', guides);
if (arg('services-ids')) {
  const ids = JSON.parse(fs.readFileSync(arg('services-ids'), 'utf8')).map((x) => x.id);
  const bySlug = new Map(JSON.parse(fs.readFileSync(path.join(out, 'structures.json'), 'utf8')).map((s) => [s.id, s.slug]));
  const ext = [];
  for (const id of ids) {
    if (!bySlug.has(id)) continue;   // a structure no longer published is not measured
    const d = await get(`/api/structures/${encodeURIComponent(bySlug.get(id))}`); const e = (d.item || d).services_externes;
    if (e && Array.isArray(e.services) && e.services.length) ext.push({ id, ext: e });
    await sl(1500);
  }
  counts.servicesExternes = ext.length; write('services_externes.json', ext);
}
fs.writeFileSync(path.join(out, 'catalogue-meta.json'), JSON.stringify({ base, at: new Date().toISOString(), counts }, null, 2));
console.log(`R38_CATALOGUE ${JSON.stringify(counts)}`);
