#!/usr/bin/env node
/**
 * Extension R32 — measured coverage of the social-sector reference (data/reference/social-domains.v1.json) by the PUBLISHED catalogue.
 *
 *   node scripts/social-coverage.mjs [--base https://www.accesdirectaide.fr] [--cache <dir with aide.json, demarche.json, guide.json, actualite.json,
 *        dispositif.json, structures.json>] --out data/reference/social-coverage.v1.json [--md <report.md>]
 *
 * For each subdomain: the verified rights content (aides, démarches, guides, dispositifs, news) whose title or text contains one of its keywords,
 * the published places of its place types, whether the cross-language search knows its domain, and the official emergency numbers it carries.
 * Status (never one merged percentage):
 *   COVERED_VERIFIED   verified rights content AND (local places, or the subdomain is national/remote by nature)
 *   PARTIALLY_COVERED  verified rights content OR places, not both
 *   TAXONOMY_ONLY      the reference names it, nothing published matches
 * A keyword match is a FINDING aid, not a relevance judgement: the matrix lists the matched slugs so a reviewer can check them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { publishedRecords } from './translate-content.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
const text = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(text).join(' ') : v && typeof v === 'object' ? Object.values(v).map(text).join(' ') : '');
const RIGHTS_FIELDS = ['titre', 'cest_quoi', 'description', 'pour_qui', 'description_courte', 'contenu_detaille', 'resume', 'contenu', 'contenu_json', 'summary_falc', 'description_falc', 'mots_cles'];
/** subdomains that are served nationally or remotely (official numbers, national procedures): local places are not required to cover them */
const REMOTE = new Set(['signalement', 'crise-suicide', 'violences-conjugales', 'violences-sexuelles', 'victimes', 'maltraitance-ages', 'harcelement', 'minima-sociaux', 'couverture-sante', 'prestations-familiales', 'mdph-droits', 'apa-aspa', 'titre-sejour', 'protection-temporaire', 'impots', 'surendettement', 'inclusion-bancaire', 'dalo', 'recours', 'mesures', 'deces-deuil', 'defenseur-droits']);

export function matchKeyword(haystack, kw) {
  const k = fold(kw); const h = fold(haystack);
  if (/^[a-z0-9]{2,5}$/i.test(kw) && kw === kw.toUpperCase()) return new RegExp(`(?<![\\p{L}\\d])${k}(?![\\p{L}\\d])`, 'u').test(h);   // acronyms: whole word
  return h.includes(k);
}

export function coverage(ref, data, lexiconIds) {
  const rows = [];
  for (const d of ref.domains) for (const s of d.subdomains) {
    const rights = [];
    for (const kind of ['aide', 'demarche', 'guide', 'dispositif', 'actualite']) {
      for (const r of data[kind] || []) {
        const hay = RIGHTS_FIELDS.map((f) => text(r[f])).join(' ');
        if (s.keywords.some((kw) => matchKeyword(hay, kw))) rights.push(`${kind}:${r.slug}`);
      }
    }
    const places = (data.structures || []).filter((p) => s.structureTypes.includes(p.type_structure));
    const inEms = places.filter((p) => /^(67000|67100|67200|67300|67380|67400|67450|67540|67800|67810|67118|67201|67202|67203|67204|67205|67206|67207|67210|67460|67500|67550|67610|67640|67720|67770|67830|67840|67850|67870|67880|67960)$/.test(String(p.code_postal || '')) || /strasbourg|schiltigheim|illkirch|lingolsheim|bischheim|hoenheim|ostwald|souffelweyersheim|eckbolsheim|wolfisheim|oberhausbergen|mittelhausbergen|niederhausbergen|reichstett|vendenheim|lampertheim|mundolsheim|la wantzenau|geispolsheim|entzheim|holtzheim|plobsheim|eschau|fegersheim|blaesheim|lipsheim|achenheim|breuschwickersheim|hangenbieten|kolbsheim|oberschaeffolsheim/i.test(fold(p.ville)));
    const remote = REMOTE.has(s.id) || s.emergency.length > 0;
    const status = rights.length && (places.length || remote) ? 'COVERED_VERIFIED' : rights.length || places.length ? 'PARTIALLY_COVERED' : 'TAXONOMY_ONLY';
    rows.push({ domain: d.id, letter: d.letter, subdomain: s.id, fr: s.fr, status,
      rightsContent: rights.length, rightsSlugs: rights.slice(0, 12), places: places.length, placesEurometropole: inEms.length, placeTypes: s.structureTypes,
      emergency: s.emergency, crossLanguageSearch: d.lexicon.some((c) => lexiconIds.has(c)), casf: s.casf, dataInclusion: s.dataInclusion,
      remoteByNature: remote, gap: status === 'COVERED_VERIFIED' ? null : rights.length ? 'missing verified local service data' : places.length ? 'missing verified rights content' : 'missing content and service data' });
  }
  const count = (k) => rows.reduce((a, r) => ({ ...a, [r[k]]: (a[r[k]] || 0) + 1 }), {});
  return { schema: 'ada-social-coverage/1', reference: ref.version, measuredAt: new Date().toISOString(), totals: { subdomains: rows.length, byStatus: count('status') },
    byDomain: ref.domains.map((d) => ({ domain: d.id, letter: d.letter, fr: d.fr, ...Object.fromEntries(['COVERED_VERIFIED', 'PARTIALLY_COVERED', 'TAXONOMY_ONLY'].map((st) => [st, rows.filter((r) => r.domain === d.id && r.status === st).length])) })),
    rows, note: 'Keyword and place-type matches against the published (D-5 verified) catalogue. A match is not a relevance judgement; places are physical establishments, not verified services (the catalogue has no service-level records yet).' };
}

async function main() {
  const ref = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
  const lex = JSON.parse(fs.readFileSync('data/i18n/search-lexicon.json', 'utf8'));
  const cache = arg('cache'); const base = arg('base', 'https://www.accesdirectaide.fr');
  const data = {};
  for (const kind of ['aide', 'demarche', 'guide', 'dispositif', 'actualite']) data[kind] = cache ? JSON.parse(fs.readFileSync(path.join(cache, `${kind}.json`), 'utf8')) : await publishedRecords(base, kind);
  data.structures = cache ? JSON.parse(fs.readFileSync(path.join(cache, 'structures.json'), 'utf8')) : [];
  const out = coverage(ref, data, new Set(lex.concepts.map((c) => c.id)));
  out.catalogue = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  fs.writeFileSync(arg('out', 'data/reference/social-coverage.v1.json'), `${JSON.stringify(out, null, 1)}\n`);
  if (arg('md')) {
    const lines = ['| Domaine | Couvert (vérifié) | Partiel | Seulement nommé |', '|---|---|---|---|', ...out.byDomain.map((d) => `| ${d.letter}. ${d.fr} | ${d.COVERED_VERIFIED} | ${d.PARTIALLY_COVERED} | ${d.TAXONOMY_ONLY} |`)];
    fs.writeFileSync(arg('md'), `${lines.join('\n')}\n`);
  }
  console.log(JSON.stringify({ totals: out.totals, catalogue: out.catalogue }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.stack || e); process.exitCode = 1; });
