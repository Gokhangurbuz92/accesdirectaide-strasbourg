#!/usr/bin/env node
/**
 * Catalogue (12/11/2026) — the official online services of Service-Public.gouv.fr (DILA « vos droits » flux, Licence Ouverte 2.0) as the toolbox's catalogue:
 * simulators, online procedures (téléservices), official forms (cerfa), letter templates and search tools, each with its operator, its topic, the fiches that
 * cite it, and the date its address answered. Before it the toolbox listed ten hand-picked links.
 *
 *   node scripts/build-official-services.mjs [--zip <vosdroits-latest.zip>] [--check] [--out src/config/officialServices.generated.json]
 *
 * --check opens every address (GET, 12 s, at most 3 at a time and one at a time per host, a browser-like Accept header, no cookie, no login): a service whose
 * address does not answer 2xx/3xx is left out and counted, never listed. Without --zip the archive of the day is downloaded from the DILA.
 * Only the service's own words (title, short description, operator) are kept: the platform does not run these services and does not vouch for a result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { DILA_ARCHIVE_URL } from '../api/_services/verification/dila.js';
import { THEMES, OUR_COVERAGE } from '../api/_services/verification/classify.js';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const out = arg('out', 'src/config/officialServices.generated.json');
const squash = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = String(xml).match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? squash(m[1]) : null; };

/** the DILA resource types → the toolbox's kinds (the « …NG » types are the same kinds in the new templates) */
export const KINDS = Object.freeze({
  Simulateur: 'simulateur', simulateurNG: 'simulateur',
  'Téléservice': 'teleservice', selNG: 'teleservice', 'Service en ligne': 'teleservice',
  Formulaire: 'formulaire', formulaireNG: 'formulaire',
  'Modèle de document': 'modele', lettreTypeNG: 'modele',
  'Outil de recherche': 'recherche', outilRechercheNG: 'recherche',
});

export function readServices(zipBytes) {
  const files = unzipSync(zipBytes, { filter: (f) => /^[RF]\d+\.xml$/.test(f.name) || f.name === 'redirections.xml' });
  const cited = new Map();   // R… → fiches F… that list it
  for (const [name, u8] of Object.entries(files)) {
    if (!name.startsWith('F')) continue;
    const id = name.replace('.xml', '');
    for (const m of strFromU8(u8).matchAll(/<ServiceEnLigne[^>]*\sID="(R\d+)"/g)) { const s = cited.get(m[1]) || new Set(); s.add(id); cited.set(m[1], s); }
  }
  const builtAt = (() => { const r = files['redirections.xml']; const m = r ? strFromU8(r).slice(0, 800).match(/<dc:date[^>]*>([^<]+)</) : null; return m ? m[1] : null; })();
  const items = []; const skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  for (const [name, u8] of Object.entries(files)) {
    if (!name.startsWith('R')) continue;
    const xml = strFromU8(u8);
    const id = name.replace('.xml', '');
    const rawType = (xml.match(/<ServiceComplementaire[^>]*\stype="([^"]+)"/) || [])[1] || tag(xml, 'dc:type');
    const kind = KINDS[rawType] || KINDS[tag(xml, 'dc:type') || ''] || null;
    if (!kind) { skip(`type:${rawType || 'none'}`); continue; }
    if (!OUR_COVERAGE.test(tag(xml, 'dc:coverage') || '')) { skip('coverage'); continue; }
    const head = xml.slice(0, xml.indexOf('<FilDAriane') > 0 ? xml.indexOf('<FilDAriane') : 4000);
    const url = (head.match(/<ServiceComplementaire[^>]*\sURL="([^"]+)"/) || xml.match(/<LienWeb[^>]*\sURL="([^"]+)"/) || [])[1] || null;
    if (!url || !/^https:\/\//.test(url)) { skip('no-https-url'); continue; }
    const theme = (xml.match(/<Theme ID="N\d+"><Titre>([^<]+)<\/Titre>/) || [])[1] || tag(xml, 'dc:subject') || '';
    const t = THEMES.find((x) => x.re.test(theme));
    const numero = (xml.match(/<NumeroCerfa>([^<]+)</) || [])[1] || null;
    items.push({ id, kind, title: tag(xml, 'dc:title'), description: tag(xml, 'dc:description'), url, operator: tag(xml, 'Source') || null, theme: squash(theme) || null,
      categorie: t ? t.categorie : null, cerfa: numero ? squash(numero) : null, cost: tag(xml, 'Cout'), public: tag(xml, 'Public'), modifiedAt: (tag(xml, 'dc:date') || '').replace(/^modified\s*/, '') || null,
      fiches: [...(cited.get(id) || [])].sort().slice(0, 8), sourceUrl: `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}` });
  }
  // one entry per address (the same service listed twice under two numbers)
  const byUrl = new Map();
  for (const it of items.sort((a, b) => b.fiches.length - a.fiches.length || a.id.localeCompare(b.id))) if (!byUrl.has(it.url)) byUrl.set(it.url, it); else skip('duplicate-url');
  return { builtAt, items: [...byUrl.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr')), skipped };
}

/**
 * What a person must know before clicking (B3, 12/11/2026): a service of another département is left out (« Allier (03) : Demande … »); a link to a site's
 * home page is a « site officiel », not a tool; a service behind a login says so; a PDF is a form to download; a service for companies, foundations or
 * professionals is marked for them (the toolbox shows the services for individuals first); the same title twice is one entry.
 * @param {any[]} items @returns {{ items: any[], dropped: Record<string, number> }}
 */
export function refine(items) {
  const dropped = {}; const drop = (k) => { dropped[k] = (dropped[k] || 0) + 1; };
  const out = []; const seen = new Map();
  for (const it of items) {
    const dep = String(it.title).match(/^([^:]{2,60}?)\s*\((\d{2,3}|2A|2B)\)\s*:/);
    if (dep && dep[2] !== '67') { drop('other-departement'); continue; }
    let u; try { u = new URL(it.url); } catch { drop('bad-url'); continue; }
    // a signed download address (token / key / signature in the query) is not a stable official link, and a token-shaped string has no place in a public repository
    if ([...u.searchParams.keys()].some((k) => /token|key|sig|signature|expires|credential/i.test(k))) { drop('signed-url'); continue; }
    const generic = (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash.replace('#/', '').length;
    const login = /login|connexion|espace[-_ ]?(perso|personnel|particulier)|mon-?compte|moncompte|authentification/i.test(`${u.pathname} ${u.hash}`) || /espace personnel|se connecter|mon compte/i.test(it.title);
    const pdf = /\.pdf$/i.test(u.pathname);
    const pro = /(entreprise|soci[ée]t[ée]|fondation|fonds de dotation|professionnel|artisan|commer[çc]ant|exploitant|employeur)/i.test(it.title) && !/particulier/i.test(it.title);
    const key = `${String(it.title).trim().toLowerCase()}|${it.kind}`;
    if (seen.has(key)) { drop('duplicate-title'); continue; }
    seen.set(key, true);
    out.push({ ...it, ...(generic ? { generic: true } : {}), ...(login ? { login: true } : {}), ...(pdf ? { pdf: true } : {}), audience: pro ? 'pro' : 'particuliers', ...(dep ? { departement: '67' } : {}) });
  }
  return { items: out, dropped };
}

/** @param {any} it */
export const slim = (it) => ({ id: it.id, kind: it.kind, title: it.title, url: it.url, operator: it.operator || null, categorie: it.categorie || null, cerfa: it.cerfa || null, audience: it.audience || 'particuliers', ...(it.generic ? { generic: true } : {}), ...(it.login ? { login: true } : {}), ...(it.pdf ? { pdf: true } : {}),
  ...(it.departement ? { departement: it.departement } : {}), cited: Array.isArray(it.fiches) ? it.fiches.length : (it.cited || 0), checkedAt: it.checkedAt || null });

async function check(items) {
  const hosts = new Map(); const results = new Map(); let i = 0;
  const one = async (it) => {
    const host = new URL(it.url).hostname;
    while (hosts.get(host)) await new Promise((r) => setTimeout(r, 50));
    hosts.set(host, true);
    try {
      const r = await fetch(it.url, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'User-Agent': 'AccesDirectAide-link-check/1.0' } });
      results.set(it.url, { status: r.status, finalHost: new URL(r.url).hostname });
      try { await r.body?.cancel(); } catch { /* none */ }
    } catch (e) { results.set(it.url, { status: 0, error: String(e?.cause?.code || e?.name || e).slice(0, 60) }); }
    finally { hosts.set(host, false); await new Promise((r) => setTimeout(r, 300)); }
  };
  const workers = Array.from({ length: 3 }, async () => { while (i < items.length) { const it = items[i++]; await one(it); } });
  await Promise.all(workers);
  return results;
}

async function main() {
  const zipPath = arg('zip');
  let bytes;
  if (zipPath) bytes = new Uint8Array(fs.readFileSync(zipPath));
  else { const r = await fetch(DILA_ARCHIVE_URL); if (!r.ok) throw new Error(`DILA ${r.status}`); bytes = new Uint8Array(await r.arrayBuffer()); }
  const { builtAt, items, skipped } = readServices(bytes);
  let kept = items; const failed = {};
  const at = new Date().toISOString().slice(0, 10);
  if (process.argv.includes('--check')) {
    const res = await check(items);
    kept = items.filter((it) => { const s = res.get(it.url)?.status || 0; const ok = s >= 200 && s < 400; if (!ok) failed[s || res.get(it.url)?.error || 'error'] = (failed[s || res.get(it.url)?.error || 'error'] || 0) + 1; return ok; })
      .map((it) => ({ ...it, checkedAt: at }));
  }
  // the page carries only what it shows (the address, the service's own title, its operator, its kind and topic, its cerfa number, how many fiches cite it)
  const refined = refine(kept); kept = refined.items.map(slim);
  const doc = { schema: 'ada.official-services.v1', generatedAt: new Date().toISOString(), checkedAt: process.argv.includes('--check') ? at : null,
    source: { publisher: 'Service-Public.gouv.fr / DILA', licence: 'Licence Ouverte 2.0 (Etalab)', licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/', url: DILA_ARCHIVE_URL, file: 'vosdroits-latest.zip', date: builtAt },
    counts: { read: items.length, kept: kept.length, skipped, failed, refined: refined.dropped, byKind: kept.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] || 0) + 1 }), {}) }, items: kept };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(JSON.stringify(doc.counts));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main().catch((e) => { console.error(e); process.exit(1); });
