#!/usr/bin/env node
/**
 * R47 quality — counts the crawl (crawl.pw.mjs JSON lines): per check and per language, the number of visits with at least one finding and the number of
 * findings; the distinct untranslated interface strings (French source text shown on a non-French page outside a lang="fr" fragment) split into
 * interface text (a defect), record content (data written in French, shown as such) and names (brands, places, addresses, technical values); the
 * internal links that land on the not-found page. Writes report.json and prints a summary.   node e2e-r47/quality/report.mjs <crawl output dir> [--base <url>]
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const visits = rows.filter((r) => !r.kind); const redirects = rows.filter((r) => r.kind === 'redirect'); const access = rows.filter((r) => r.kind === 'access');
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];

/** names that stay as they are in every language (brands, programmes, places), identifiers and technical values */
const NAME = /^(AccesDirect( Pro)?|Accès ?Direct ?Aide|AccesDirectAide|ADA|FranceConnect|ProConnect|Service-Public\.fr|service-public\.fr|Légifrance|CNIL|CAF|CPAM|MSA|France Travail|Pôle emploi|Eurométropole de Strasbourg|Strasbourg|Bas-Rhin|Alsace|Grand Est|CDGG Conseil|data\.inclusion|FINESS|SIRET|INSEE|RGPD|FALC|Mon Parcours|Mon Espace|Ollama|Neon|Vercel|Sentry|Upstash|Microsoft Graph|Twilio|Brevo|Resend|development|production|memory|test|lab|LAB|PostgreSQL|Europe\/Paris|OK|Défenseur des droits|Licence Ouverte 2\.0|Ameli \(Assurance Maladie\)|Vercel (Inc\. —|Web Analytics|Speed Insights)|Sentry —|Annuaire de l'administration \(Service-Public\)|Annuaire des entreprises \(répertoire SIRENE\)|SMS \(Twilio\)|Aides-territoires \(API\))$/i;
const DATA = /synthétique|fictif|fictive|Fiche de test|r47q|\bLAB\b|Texte de test|Résumé de test|Point de test|rue Synthétique|Permanence synthétique|Lundi au vendredi 9 h/i;
// where a string comes from: a literal of the interface code (src/ — a defect: it must be translated), a text written by the API (api/ — the server speaks
// French; the screen must translate it from a code), or neither (record content: names, titles, review notes stored in the database or the data files)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const readTree = (/** @type {string} */ d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (['node_modules', 'locales', 'tests', '__tests__'].includes(e.name) ? [] : readTree(path.join(d, e.name))) : /\.(jsx?|mjs|ts)$/.test(e.name) ? [fs.readFileSync(path.join(ROOT, d, e.name), 'utf8')] : []);
const norm = (/** @type {string} */ x) => x.replace(/[’']/g, "'").replace(/\s+/g, ' ');
const SRC = norm(readTree('src').join('\n')); const API = norm(readTree('api').join('\n'));
/** the translated values of each language: a text identical to the French one that IS the translation (« Export CSV », « SMS (Twilio) ») is not a defect */
const LOCALE_VALUES = Object.fromEntries(['en', 'tr', 'ar', 'de', 'uk'].map((l) => { const d = path.join(ROOT, 'src/i18n/locales', l); return [l, new Set(fs.readdirSync(d).flatMap((f) => Object.values(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))).map((v) => norm(String(v)).trim())))]; }));
// R47 langfr: the same for a translation with values (« Page {{page}} / {{total}} », « Items ({{n}}) »): the text matches the language's own pattern
// (only patterns with at least four letters of their own, so a bare « {{name}} » never excuses anything)
const esc = (/** @type {string} */ x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LOCALE_PATTERNS = Object.fromEntries(Object.entries(LOCALE_VALUES).map(([l, set]) => [l, [...set].filter((v) => /\{\{\w+\}\}/.test(v) && (v.replace(/\{\{\w+\}\}/g, '').match(/\p{L}/gu) || []).length >= 4)
  .map((v) => new RegExp(`^${v.split(/\{\{\w+\}\}/).map(esc).join('.+')}$`))]));
const classify = (/** @type {string} */ s, /** @type {string} */ lang = '') => {
  if (lang && LOCALE_VALUES[lang]?.has(norm(s).trim())) return 'translated';
  if (lang && LOCALE_PATTERNS[lang]?.some((re) => re.test(norm(s).trim()))) return 'translated';
  if (/@|^www\.|^https?:|\.(fr|com|org|test|eu)\b/.test(s) || NAME.test(s.trim()) || /^[\d\s.,:/+()–-]+$/.test(s) || /^\d{2} \d{2} \d{2} \d{2} \d{2}$/.test(s)) return 'name';
  if (/^[a-z0-9._][a-z0-9_./-]*$/.test(s) || /^[A-Z0-9_]+(\/[A-Z_]+)?$/.test(s) || /^[a-z_-]+(, [a-zA-Z_-]+)+$/.test(s) || /^(GET|POST) \/api\//.test(s) || /^#[a-z_]+=$/.test(s)) return 'name';   // identifiers shown as such (job names, codes, file names)
  if (DATA.test(s)) return 'data';
  const n = norm(s);
  if (SRC.includes(n)) return 'ui';
  if (API.includes(n)) return 'server';
  return 'data';
};

/** a refused request the page itself expects: the signed-out probe (401) or the unknown record of a deliberately unknown address (404) */
// (a professional member's page probing an administrator-only list, which the page then explains: 403; the citizen probe /api/auth/me for any other role: 401;
// the LAB origin gate on the « J'ai besoin d'aide pour… » search at a non-5173 port: 403 on /trouver-aide — an artefact of this harness, not of the product)
const expectedConsole = (/** @type {any} */ r, /** @type {string} */ e) => (/status of 401 \(Unauthorized\)/.test(e) && r.role !== 'citizen') || (/status of 404 \(Not Found\)/.test(e) && /r47q-inconnu|\/view$/.test(r.path))
  || (/status of 403 \(Forbidden\)/.test(e) && (r.role === 'pro' || /r47q-inconnu/.test(r.path) || r.path === '/trouver-aide'));
const CHECKS = {
  'HTTP/API 5xx': (r) => r.fiveXX.length,
  'console errors': (r) => r.consoleErrors.filter((e) => !expectedConsole(r, e)).length,
  'console 4xx expected (anonymous / unknown record)': (r) => r.consoleErrors.filter((e) => expectedConsole(r, e)).length,
  'untranslated UI text': (r) => (r.untranslated || []).filter((s) => classify(s, r.lang) === 'ui').length,
  'untranslated server text (API French)': (r) => (r.untranslated || []).filter((s) => classify(s, r.lang) === 'server').length,
  'French record content not marked lang=fr': (r) => (r.untranslated || []).filter((s) => classify(s, r.lang) === 'data').length,
  'raw i18n keys': (r) => (r.rawKeys || []).filter((k) => r.path !== '/cookies' && !/^(tout_public|centre_social)$/.test(k)).length,   // /cookies lists the storage names on purpose; the two codes are this seed's values
  'empty text elements': (r) => (r.empty || []).length,
  'html lang mismatch': (r) => (r.htmlLang !== r.lang ? 1 : 0),
  'Arabic not rtl': (r) => (r.lang === 'ar' && r.dir !== 'rtl' ? 1 : 0),
  'horizontal overflow': (r) => (r.overflow ? 1 : 0),
  'element off-screen': (r) => (r.offscreen || []).length,
  'h1 count ≠ 1': (r) => (r.h1 === 1 ? 0 : 1),
  'focus not visible': (r) => (r.focus || []).length,
  'axe serious/critical (nodes)': (r) => r.axe.reduce((n, a) => n + a.nodes, 0),
  'buttons/links without name': (r) => (r.noName || []).length,
  'left loading': (r) => (r.busy ? 1 : 0),
  'blank main': (r) => (r.mainText < 20 ? 1 : 0),
  'junk values': (r) => (r.junk || []).length,
  'French dates on non-French page': (r) => (r.frDates || []).filter((x) => !DATA.test(x)).length,
  'not-found page': (r) => (r.notFound ? 1 : 0),
};
/** @type {Record<string, Record<string, { visits: number, findings: number }>>} */ const table = {};
for (const [name, f] of Object.entries(CHECKS)) {
  table[name] = {};
  for (const l of LANGS) { const vs = visits.filter((r) => r.lang === l); const n = vs.map((r) => { try { return f(r); } catch { return 0; } }); table[name][l] = { visits: n.filter((x) => x > 0).length, findings: n.reduce((a, b) => a + b, 0) }; }
}
const detail = (/** @type {(r: any) => string[]} */ pick) => { const m = new Map(); for (const r of visits) for (const s of pick(r)) { const k = s; const e = m.get(k) || { n: 0, routes: new Set(), langs: new Set() }; e.n += 1; e.routes.add(r.route); e.langs.add(r.lang); m.set(k, e); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => ({ text: k, n: e.n, routes: [...e.routes].slice(0, 8), langs: [...e.langs] })); };
const untranslatedUi = detail((r) => (r.untranslated || []).filter((s) => classify(s, r.lang) === 'ui'));
const untranslatedData = detail((r) => (r.untranslated || []).filter((s) => classify(s, r.lang) === 'data'));
const report = {
  visits: visits.length, routes: new Set(visits.map((r) => `${r.role} ${r.path}`)).size, redirects: redirects.length, accessChecks: access.length, table,
  details: {
    fiveXX: detail((r) => r.fiveXX.map((x) => `${x} (${r.role} ${r.path})`)), console: detail((r) => r.consoleErrors.filter((e) => !expectedConsole(r, e)).map((e) => `${e} @ ${r.role} ${r.path}`)),
    untranslatedUi, untranslatedServer: detail((r) => (r.untranslated || []).filter((s) => classify(s, r.lang) === 'server')), untranslatedData: untranslatedData.slice(0, 80), rawKeys: detail((r) => r.rawKeys || []), empty: detail((r) => (r.empty || []).map((e) => `${e} @ ${r.path}`)),
    overflow: detail((r) => (r.overflow ? [`${r.path} ${r.viewport} ${r.lang} sw=${r.scrollWidth}`] : [])), offscreen: detail((r) => (r.offscreen || []).map((o) => `${r.viewport} ${r.path}: ${o}`)),
    h1: detail((r) => (r.h1 === 1 ? [] : [`${r.role} ${r.path} h1=${r.h1}`])), focus: detail((r) => (r.focus || []).map((x) => `${r.path}: ${x}`)),
    axe: detail((r) => r.axe.map((a) => `${a.id} (${a.impact}) ${r.path} ${a.targets.join(' ; ')}`)), noName: detail((r) => (r.noName || []).map((x) => `${r.path}: ${x}`)),
    busy: detail((r) => (r.busy ? [`${r.role} ${r.path}`] : [])), blank: detail((r) => (r.mainText < 20 ? [`${r.role} ${r.path}`] : [])), junk: detail((r) => (r.junk || []).map((x) => `${r.path}: ${x}`)),
    frDates: detail((r) => (r.frDates || []).map((x) => `${r.path}: ${x}`)), notFound: detail((r) => (r.notFound ? [`${r.role} ${r.path}`] : [])),
    api4xx: detail((r) => (r.api4xx || []).filter((x) => !/^401 GET \/api\/auth\/me$/.test(x)).map((x) => `${x} (${r.role} ${r.path})`)),
    redirects: redirects.map((r) => `${r.path} → ${r.finalPath}${r.notFound ? ' (NOT FOUND)' : ''}${r.fiveXX.length ? ` 5xx ${r.fiveXX}` : ''}`),
    access: access.map((r) => `${r.role} ${r.path} [${r.lang}] → ${r.finalPath} | h1: ${r.h1} | ${r.text.slice(0, 160)}`),
  },
};
// internal links offered by the pages that the router answers with its not-found page: each unique link is resolved against the crawled pages
const crawled = new Map(visits.map((r) => [r.path, r.notFound]));
const links = new Map(); for (const r of visits) for (const h of r.internalLinks || []) { if (!links.has(h)) links.set(h, new Set()); links.get(h).add(r.path); }
report.internalLinks = links.size;
report.deadLinksKnown = [...links.entries()].filter(([h]) => crawled.get(h) === true).map(([h, from]) => ({ link: h, from: [...from].slice(0, 5) }));
report.uncrawledLinks = [...links.keys()].filter((h) => !crawled.has(h));
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
console.log(`visits ${report.visits} (${report.routes} route×role), redirects ${report.redirects}, access checks ${report.accessChecks}, internal links ${report.internalLinks} (uncrawled ${report.uncrawledLinks.length})`);
console.log(`${'check'.padEnd(44)}${LANGS.map((l) => l.padStart(12)).join('')}   (visits with ≥1 / findings)`);
for (const [name, per] of Object.entries(table)) console.log(`${name.padEnd(44)}${LANGS.map((l) => `${per[l].visits}/${per[l].findings}`.padStart(12)).join('')}`);
