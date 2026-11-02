#!/usr/bin/env node
/**
 * Extension R32 — measured coverage of the social-sector reference (data/reference/social-domains.v1.json) by the PUBLISHED catalogue.
 *
 *   node scripts/social-coverage.mjs [--base https://www.accesdirectaide.fr] [--cache <dir with aide.json, demarche.json, guide.json, actualite.json,
 *        dispositif.json, structures.json>] [--scenarios <orientation results.json>] [--services <services_externes.json>] --out data/reference/social-coverage.v1.json [--md <report.md>]
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
import TERMS from '../api/_services/verification/datainclusion-terms.js';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
const text = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(text).join(' ') : v && typeof v === 'object' ? Object.values(v).map(text).join(' ') : '');
const RIGHTS_FIELDS = ['titre', 'cest_quoi', 'description', 'pour_qui', 'description_courte', 'contenu_detaille', 'resume', 'contenu', 'contenu_json', 'summary_falc', 'description_falc', 'mots_cles'];
/** subdomains that are served nationally or remotely (official numbers, national procedures): local places are not required to cover them */
const REMOTE = new Set(['signalement', 'crise-suicide', 'violences-conjugales', 'violences-sexuelles', 'victimes', 'maltraitance-ages', 'harcelement', 'minima-sociaux', 'couverture-sante', 'prestations-familiales', 'mdph-droits', 'apa-aspa', 'titre-sejour', 'protection-temporaire', 'impots', 'surendettement', 'inclusion-bancaire', 'dalo', 'recours', 'mesures', 'deces-deuil', 'defenseur-droits']);

/** the Eurométropole de Strasbourg: postal codes and towns */
const EMS_POSTCODE = /^(67000|67100|67200|67300|67380|67400|67450|67540|67800|67810|67118|67201|67202|67203|67204|67205|67206|67207|67210|67460|67500|67550|67610|67640|67720|67770|67830|67840|67850|67870|67880|67960)$/;
const EMS_TOWN = /strasbourg|schiltigheim|illkirch|lingolsheim|bischheim|hoenheim|ostwald|souffelweyersheim|eckbolsheim|wolfisheim|oberhausbergen|mittelhausbergen|niederhausbergen|reichstett|vendenheim|lampertheim|mundolsheim|la wantzenau|geispolsheim|entzheim|holtzheim|plobsheim|eschau|fegersheim|blaesheim|lipsheim|achenheim|breuschwickersheim|hangenbieten|kolbsheim|oberschaeffolsheim/i;
const isEms = (p) => EMS_POSTCODE.test(String(p.code_postal || '')) || EMS_TOWN.test(fold(p.ville));
/** data·inclusion thématique label → code (the schema's own vocabulary) */
const CODE_OF_THEME = new Map(Object.entries(TERMS.lists.thematiques || {}).map(([code, label]) => [label, code]));

export function matchKeyword(haystack, kw) {
  const k = fold(kw); const h = fold(haystack);
  if (/^[a-z0-9]{2,5}$/i.test(kw) && kw === kw.toUpperCase()) return new RegExp(`(?<![\\p{L}\\d])${k}(?![\\p{L}\\d])`, 'u').test(h);   // acronyms: whole word
  return h.includes(k);
}

/** @param {any} ref @param {any} data @param {Set<string>} lexiconIds @param {Map<string, number>} [scenarioHits] passing orientation scenarios per subdomain */
export function coverage(ref, data, lexiconIds, scenarioHits = new Map()) {
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
    const inEms = places.filter(isEms);
    const remote = REMOTE.has(s.id) || s.emergency.length > 0;
    const status = rights.length && (places.length || remote) ? 'COVERED_VERIFIED' : rights.length || places.length ? 'PARTIALLY_COVERED' : 'TAXONOMY_ONLY';
    // R34: the stricter evidence ladder. A keyword in a long text, or a building of the right type, is not proof that a service exists for this need.
    const titled = []; const procedures = [];
    for (const kind of ['aide', 'demarche', 'guide', 'dispositif']) for (const r of data[kind] || []) {
      if (s.keywords.some((kw) => matchKeyword(text(r.titre), kw))) { titled.push(`${kind}:${r.slug}`); if (kind === 'demarche' || kind === 'guide') procedures.push(`${kind}:${r.slug}`); }
    }
    // the services of a place: its own declared list, and the services data·inclusion attributes to it (Structure.services_externes: schema labels only,
    // each with its producer and authority — a public operator, the managing body, or a self-declaration on a platform)
    const themeOk = (label) => { const code = CODE_OF_THEME.get(label); return Boolean(code) && s.dataInclusion.some((t) => (t.endsWith('--') ? code.startsWith(t) : code === t)); };
    const matching = (p) => [
      ...(Array.isArray(p.services) ? p.services : []).filter((x) => s.keywords.some((kw) => matchKeyword(String(x), kw))).map(() => ({ authority: 'STRUCTURE', updatedAt: p.date_verification })),
      ...((p.services_externes && p.services_externes.services) || []).filter((x) => (x.themes || []).some(themeOk) || s.keywords.some((kw) => matchKeyword(`${x.nom} ${(x.themes || []).join(' ')}`, kw))),
    ];
    const services = (data.structures || []).map((p) => ({ p, list: matching(p) })).filter((x) => x.list.length);
    const servicesEms = services.filter((x) => isEms(x.p));
    const contact = (p) => Boolean(p.telephone || p.email || p.site_web);
    const official = (x) => x.list.some((v) => v.authority === 'OPERATEUR_PUBLIC' || v.authority === 'ORGANISME_GESTIONNAIRE');
    const fresh = (x) => x.p.date_verification && Date.now() - Date.parse(x.p.date_verification) < 90 * 86400e3 && x.list.some((v) => v.updatedAt && Date.now() - Date.parse(v.updatedAt) < 365 * 86400e3);
    const evidence = {
      taxonomy: true,
      officialTopicSource: titled.length > 0 || s.emergency.length > 0,
      verifiedRightsContent: rights.length > 0,
      verifiedRightsByTitle: titled.length > 0,
      verifiedProcedure: procedures.length > 0,
      verifiedEstablishment: places.length > 0,
      declaredSpecificService: services.length > 0,
      verifiedSpecificService: services.some(official),
      territorialEligibility: remote || servicesEms.length > 0,
      accessModality: remote ? s.emergency.length > 0 || titled.length > 0 : servicesEms.some((x) => contact(x.p)),
      currentAvailability: !remote && servicesEms.some((x) => contact(x.p) && fresh(x)),
      orientationTested: (scenarioHits.get(s.id) || 0) > 0,
    };
    // SERVICE_VERIFIED: the right is named by an official title AND a person can reach it — by the official national channel for a need served
    // remotely by nature, or by a verified local service of the Eurométropole with a way to contact it and its opening hours
    // SERVICE_DECLARED: the same, but the local service is only self-declared on a platform (attributed to its producer, not verified by the State)
    const localOk = (pred) => servicesEms.some((x) => pred(x) && contact(x.p));
    const serviceStatus = evidence.verifiedRightsByTitle && (remote ? evidence.accessModality : localOk(official)) ? 'SERVICE_VERIFIED'
      : evidence.verifiedRightsByTitle && !remote && localOk(() => true) ? 'SERVICE_DECLARED'
        : evidence.verifiedRightsByTitle || evidence.declaredSpecificService ? 'SERVICE_PARTIAL' : 'NO_VERIFIED_SERVICE';
    rows.push({ domain: d.id, letter: d.letter, subdomain: s.id, fr: s.fr, status,
      rightsContent: rights.length, rightsSlugs: rights.slice(0, 12), places: places.length, placesEurometropole: inEms.length, placeTypes: s.structureTypes,
      emergency: s.emergency, crossLanguageSearch: d.lexicon.some((c) => lexiconIds.has(c)), casf: s.casf, dataInclusion: s.dataInclusion,
      remoteByNature: remote, evidence, serviceStatus, titledSlugs: titled.slice(0, 8), services: services.length, servicesEurometropole: servicesEms.length, servicesOfficial: services.filter(official).length, servicePlaces: servicesEms.slice(0, 6).map((x) => x.p.slug), gap: status === 'COVERED_VERIFIED' ? null : rights.length ? 'missing verified local service data' : places.length ? 'missing verified rights content' : 'missing content and service data' });
  }
  const count = (k) => rows.reduce((a, r) => ({ ...a, [r[k]]: (a[r[k]] || 0) + 1 }), {});
  return { schema: 'ada-social-coverage/1', reference: ref.version, measuredAt: new Date().toISOString(), totals: { subdomains: rows.length, byStatus: count('status'), byServiceStatus: count('serviceStatus'),
      evidence: Object.fromEntries(Object.keys(rows[0]?.evidence || {}).map((k) => [k, rows.filter((r) => r.evidence[k]).length])) },
    byDomain: ref.domains.map((d) => ({ domain: d.id, letter: d.letter, fr: d.fr, ...Object.fromEntries(['COVERED_VERIFIED', 'PARTIALLY_COVERED', 'TAXONOMY_ONLY'].map((st) => [st, rows.filter((r) => r.domain === d.id && r.status === st).length])) })),
    rows, note: 'Two measurements. status = content coverage (keyword anywhere in published rights content, or places of the type). serviceStatus = stricter service coverage (official title naming the need, and a reachable channel: the national one for remote needs, a local SERVICE — not a building — with a contact channel otherwise: SERVICE_VERIFIED when a public operator or the managing body lists it, SERVICE_DECLARED when it is only self-declared on a platform). Keyword and place-type matches against the published (D-5 verified) catalogue. A match is not a relevance judgement; places are physical establishments, not verified services (the catalogue has no service-level records yet).' };
}

async function main() {
  const ref = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
  const lex = JSON.parse(fs.readFileSync('data/i18n/search-lexicon.json', 'utf8'));
  const cache = arg('cache'); const base = arg('base', 'https://www.accesdirectaide.fr');
  const data = {};
  for (const kind of ['aide', 'demarche', 'guide', 'dispositif', 'actualite']) data[kind] = cache ? JSON.parse(fs.readFileSync(path.join(cache, `${kind}.json`), 'utf8')) : await publishedRecords(base, kind);
  data.structures = cache ? JSON.parse(fs.readFileSync(path.join(cache, 'structures.json'), 'utf8')) : [];
  // the list API does not carry the data·inclusion services of a place: --services <file [{ id, ext }]> (read from the database) adds them
  if (arg('services')) { const ext = new Map(JSON.parse(fs.readFileSync(arg('services'), 'utf8')).map((x) => [x.id, x.ext])); for (const p of data.structures) if (ext.has(p.id)) p.services_externes = ext.get(p.id); }
  // passing orientation scenarios (scripts/orientation-scenarios.mjs --out) count for a subdomain when one of its keywords is in the scenario's words
  const scenarioHits = new Map();
  if (arg('scenarios')) {
    const sc = JSON.parse(fs.readFileSync('data/reference/orientation-scenarios.v1.json', 'utf8')).scenarios;
    const res = JSON.parse(fs.readFileSync(arg('scenarios'), 'utf8')).rows;
    for (const d of ref.domains) for (const sd of d.subdomains) {
      const n = res.filter((r) => r.pass && r.expect !== 'abstain').filter((r) => { const s = sc.find((x) => x.id === r.id); return s && sd.keywords.some((kw) => [s.query, ...(s.words || [])].some((w) => matchKeyword(w, kw) || matchKeyword(kw, w))); }).length;
      if (n) scenarioHits.set(sd.id, n);
    }
  }
  const out = coverage(ref, data, new Set(lex.concepts.map((c) => c.id)), scenarioHits);
  out.catalogue = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  fs.writeFileSync(arg('out', 'data/reference/social-coverage.v1.json'), `${JSON.stringify(out, null, 1)}\n`);
  if (arg('md')) {
    const lines = ['| Domaine | Couvert (vérifié) | Partiel | Seulement nommé |', '|---|---|---|---|', ...out.byDomain.map((d) => `| ${d.letter}. ${d.fr} | ${d.COVERED_VERIFIED} | ${d.PARTIALLY_COVERED} | ${d.TAXONOMY_ONLY} |`)];
    fs.writeFileSync(arg('md'), `${lines.join('\n')}\n`);
  }
  console.log(JSON.stringify({ totals: out.totals, catalogue: out.catalogue }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.stack || e); process.exitCode = 1; });
