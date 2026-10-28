// @ts-nocheck
/**
 * Automatic verification chain — FINESS+ (Agence du numérique en santé), the national register of health, social and medico-social establishments.
 *
 * Since 20 July 2026 the register is published as two daily open-data files on data.gouv.fr (Licence Ouverte 2.0): « FINESS - Structures »
 * (finess-structures-1: legal entities PMEJ with their geographic establishments EGE, cooperation groupings GCO / GCC) and « FINESS - Activités »
 * (finess-activites-1: the authorized and exercised activities of each structure). The old extraction stopped being updated with that change.
 *
 *  - the file of the day is found through the data.gouv.fr API, downloaded as a stream (never held in memory) and its SHA-1 compared with the one the publisher
 *    declares; the files are about 50 MB compressed and 0.8 GB uncompressed, so they are read as a stream too: one legal entity at a time (arrayElements);
 *  - only geographic establishments (EGE: the places) of the département are kept, and among them only the kinds of establishment a person may turn to for
 *    care, social support, housing, older people or disability (SCOPE, official category codes TRE-R397). Pharmacies, laboratories, schools, hospital
 *    administration and the services that take people in only on a judge's or the child welfare's decision are not directory records;
 *  - an establishment is open when FINESS says so (macro-state A of TRE-R386, no closing date); a closed one is never published, and a record made from FINESS is
 *    withdrawn when FINESS closes it or no longer lists it;
 *  - what a record says is what FINESS establishes: name, official kind, address, telephone, open state, the publics of its active authorized activities
 *    (TRE-R403). Being registered does not tell what a place offers each day nor how to be received: every text says so and asks to call first — no service is
 *    described that FINESS does not state (the official labels are in finess-terms.json, generated from the ANS terminologies by scripts/finess-terms.mjs).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';
import { readableCase } from './structure-check.js';
import { nominativeEmail } from './contacts.js';
import { officialJson, officialDownload, SourceError } from './fetcher.js';
import TERMS from './finess-terms.js';
import { SCOPE } from './finess-scope.js';

export { SCOPE };

export const DATASETS = { structures: 'finess-structures-1', activites: 'finess-activites-1' };
export const DATASET_PAGE = (slug) => `https://www.data.gouv.fr/datasets/${slug}`;
/** the official page of one establishment (the register's public consultation): the evidence a person can open */
export const finessPage = (num) => `https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFinesset=${encodeURIComponent(num)}`;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

export const inScope = (code) => Object.prototype.hasOwnProperty.call(SCOPE, String(code || ''));
export const officialLabel = (system, code) => TERMS.systems?.[system]?.codes?.[String(code)] ?? null;
export const termsVersion = () => Object.fromEntries(Object.entries(TERMS.systems || {}).map(([k, s]) => [k, s.version]));

/**
 * The publics of an active regulated activity (TRE-R403) in the words of the directory: the families of the official nomenclature (deficiencies 0xx–5xx,
 * older people 7xx) and the social publics it names. Children and young people placed by the child welfare or the youth justice (800–805) and adults
 * « without other indication » are not shown: they say nothing a person can use, or describe a placement.
 */
const PUBLICS = { 436: 'Personnes atteintes de la maladie d’Alzheimer ou d’une maladie apparentée', 437: 'Personnes avec des troubles du spectre de l’autisme',
  840: 'Personnes sans domicile', 821: 'Familles en difficulté ou sans logement', 810: 'Adultes en difficulté d’insertion sociale', 899: 'Personnes en difficulté',
  830: 'Personnes et familles demandeuses d’asile', 853: 'Personnes souffrant d’addictions', 826: 'Jeunes travailleurs', 841: 'Femmes enceintes et jeunes parents',
  832: 'Personnes ayant des problèmes psychiques', 860: 'Majeurs protégés', 843: 'Enfants et adolescents' };
export function publicOf(code) {
  const c = String(code || ''); if (PUBLICS[c]) return PUBLICS[c];
  const n = Number(c); if (!Number.isFinite(n)) return null;
  if (n >= 700 && n < 800) return 'Personnes âgées';
  if (n >= 10 && n < 600) return 'Personnes en situation de handicap';
  return null;
}

// --------------------------------------------------------------------------------------------------------------- reading the files as a stream
/**
 * The elements of the top-level array `key` of a JSON document, one at a time, from a stream of text chunks: a character scanner keeps the depth and whether
 * it is inside a string, and only the text of the element being read is kept (a legal entity with its establishments: a few kilobytes). The document must be
 * an object whose `key` holds an array of objects (the FINESS+ files: « pmej », « gco », « gcc »), or — `key` null — itself an array of objects (the data·inclusion
 * exports, datainclusion.js).
 * @param {AsyncIterable<string>} chunks @param {string | null} key
 */
export async function* arrayElements(chunks, key) {
  const top = key === null ? 1 : 2;   // the depth of the array once opened (its objects are one deeper)
  let depth = 0; let inStr = false; let esc = false; let keyBuf = null; let lastKey = null; let inArr = false; let acc = null;
  for await (const chunk of chunks) {
    let start = acc !== null ? 0 : -1;
    for (let i = 0; i < chunk.length; i += 1) {
      const c = chunk.charCodeAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === 92) esc = true;
        else if (c === 34) { inStr = false; if (keyBuf !== null) { lastKey = keyBuf; keyBuf = null; } }
        else if (keyBuf !== null) keyBuf += chunk[i];
        continue;
      }
      if (c === 34) { inStr = true; keyBuf = key !== null && depth === 1 && !inArr ? '' : null; continue; }
      if (c === 123 || c === 91) {
        depth += 1;
        if (c === 91 && depth === top && (key === null || lastKey === key)) inArr = true;
        else if (c === 123 && depth === top + 1 && inArr) { acc = ''; start = i; }
      } else if (c === 125 || c === 93) {
        if (c === 125 && depth === top + 1 && inArr && acc !== null) { const text = acc + chunk.slice(start, i + 1); acc = null; start = -1; yield JSON.parse(text); }
        else if (c === 93 && depth === top && inArr) { inArr = false; lastKey = null; }
        depth -= 1;
      }
    }
    if (acc !== null) acc += chunk.slice(start < 0 ? 0 : start);
  }
  if (depth !== 0 || inStr) throw new SourceError('BAD_JSON', `Fichier ${key === null ? 'data·inclusion' : 'FINESS'} incomplet (document JSON interrompu).`);
}

/** the text chunks of a gzip file (UTF-8 decoded across chunk boundaries) @param {string} file */
export function gzipText(file) {
  // pipeline, not pipe: a missing or unreadable file (or a corrupt gzip) ends the reading with that error instead of leaving it waiting
  const gz = zlib.createGunzip({ chunkSize: 1 << 20 });
  pipeline(fs.createReadStream(file, { highWaterMark: 1 << 20 }), gz, (e) => { if (e) gz.destroy(e); });
  gz.setEncoding('utf8');
  return gz;
}

// --------------------------------------------------------------------------------------------------------------- one establishment
const ACRONYM = /^(EHPAD|EHPA|CHRS|CSAPA|CAARUD|CMP|CMPP|CAMSP|ESAT|IME|SESSAD|SAVS|SAMSAH|FAM|MAS|CADA|CPH|SSIAD|SAAD|SPASAD|ITEP|MDPH|PMI|ADAPEI|APEI|AAPEI|ARSEA|ABRAPA|APF|APAJH|UNAPEI|ADMR|UDAF|CCAS|FJT|LHSS|LAM|ACT|CLAT|CEGIDD|EVARS|BAPU|MECS|EANM|EAM|CPTS|DAC|MSP|CDS|CSI|HAD|SSR|USLD|SAJ|IEM|EEAP|AFPAD|EPSAN|CHU|CHRU|CHS|CH|SOS|AGF|OHS|SAVS)$/;
/** a name the register writes in capitals, in the case people read, the acronyms kept (« EHPAD KORIAN L'AIR DU TEMPS » → « EHPAD Korian l'Air du Temps ») */
export function readableName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s || /\p{Ll}/u.test(s)) return s;
  const out = readableCase(s).split(/(\s+)/); const orig = s.split(/(\s+)/);
  return orig.map((w, i) => { const bare = w.replace(/[^\p{L}]/gu, ''); return ACRONYM.test(bare) || (bare.length >= 2 && bare.length <= 3 && !/[AEIOUY]/.test(bare)) ? w : out[i]; }).join('');
}
const phone = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : (d || null); };
const VOIE = { R: 'rue', AV: 'avenue', BD: 'boulevard', PL: 'place', RTE: 'route', CHE: 'chemin', ALL: 'allée', IMP: 'impasse', QU: 'quai', QUAI: 'quai', FG: 'faubourg', SQ: 'square', CRS: 'cours', PASS: 'passage', ZI: 'zone industrielle', ZA: 'zone d’activités', PRO: 'promenade', ESP: 'esplanade', SEN: 'sentier', CITE: 'cité', LOT: 'lotissement', RES: 'résidence' };
function streetOf(a) {
  if (a.ligneQuatre && /\p{L}/u.test(a.ligneQuatre)) return readableCase(String(a.ligneQuatre).replace(/\s+/g, ' ').trim());
  const parts = [a.numeroVoie, a.complementVoie, VOIE[String(a.typeVoie || '').toUpperCase()] || a.typeVoie, a.libelleVoie].filter(Boolean).map((x) => String(x).trim());
  return parts.length ? readableCase(parts.join(' ')) : (a.lieuDit ? readableCase(a.lieuDit) : null);
}
const cityOf = (a) => (a.ligneAcheminement ? readableCase(String(a.ligneAcheminement).replace(/\s+CEDEX(\s*\d+)?\s*$/i, '').trim()) : null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : null; };

/**
 * The establishments (EGE) of a legal entity that are in the département, as the directory needs them (also the closed ones and those of another kind: a
 * record made from FINESS is withdrawn when its establishment closes or changes kind). @param {any} pm one element of « pmej » @param {string} departement
 */
export function establishmentsOf(pm, departement = '67') {
  const ig = pm.informationsGeneralesPMEJ || {};
  return (pm.ege || []).map((g) => {
    const i = g.informationsGeneralesEGE || {};
    const a = (g.adresse || []).find((x) => String(x.cogCommune || '').startsWith(departement) || String(x.codePostal || '').startsWith(departement));
    if (!a || !i.numFinessEge) return null;
    const contact = (g.contact || []).map((c) => c.telecom || {}).find((t) => t.telephone || t.courriel) || {};
    const geo = a.coordonneesGeographique || {};
    const category = g.categorieentiteGeographiqueExercice || null;
    const closedAt = i.dateFermeture || null;
    const email = contact.courriel && !nominativeEmail(contact.courriel) ? String(contact.courriel).trim().toLowerCase() : null;
    return {
      finess: String(i.numFinessEge), egeId: String(i.egeId || ''), pmFiness: ig.numFinessPm || null, legalName: readableName(ig.denominationLonguePmSmsse || ig.denominationPm), siren: ig.siren || null,
      siret: String(i.siret || '').replace(/\D/g, '') || null, category, categoryLabel: officialLabel('categorie', category), scope: inScope(category) ? SCOPE[category] : null,
      open: g.etatObjet === 'A' && !closedAt, state: g.etatObjet || null, openedAt: i.dateOuverture || null, closedAt, updatedAt: g.dateDerniereMaj || null,
      nom: readableName(i.nomEgeLong || i.nomEgeCourt), adresse: streetOf(a), code_postal: a.codePostal || null, ville: cityOf(a), insee: a.cogCommune || null,
      latitude: num(geo.directionLatitude), longitude: num(geo.directionLongitude), telephone: phone(contact.telephone), email, evidenceUrl: finessPage(i.numFinessEge), publics: [],
    };
  }).filter(Boolean);
}

/** the publics of the active activities of one establishment's entry in « FINESS - Activités » (one element of « pmej », its « ege » list) */
export function activityPublics(egeEntry) {
  const out = new Set();
  for (const a of egeEntry.activitesExercees || []) {
    if ((a.caracteristiquesGeneriques || {}).etatObjet !== 'A') continue;
    const cs = (a.nature || {}).caracteristiquesSpecifiques || {};
    for (const v of Object.values(cs)) if (v && typeof v === 'object' && v.public) { const p = publicOf(v.public); if (p) out.add(p); }
  }
  return [...out];
}

/** the texts of a record made from FINESS: the official kind, place and open state, the publics of its activities — and what FINESS does not say */
export function finessTexts(e, { updatedDay } = {}) {
  const kind = e.scope ? e.scope[0] : (e.categoryLabel || 'établissement sanitaire ou social');
  const where = [e.adresse, [e.code_postal, e.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const publics = (e.publics || []).slice(0, 4);
  const resume = `${e.nom} est un établissement de type « ${kind} »${e.ville ? ` à ${e.ville}` : ''}. Le répertoire national FINESS (ministère de la Santé, Agence du numérique en santé) l’enregistre comme ouvert${updatedDay ? ` (mise à jour du ${updatedDay})` : ''}.`
    + (publics.length ? ` Publics de ses activités autorisées : ${publics.map((p) => p.charAt(0).toLowerCase() + p.slice(1)).join(' ; ')}.` : '')
    + ' Ce répertoire confirme l’identité, l’adresse et le téléphone de l’établissement, pas les services qu’il propose ni les conditions pour y être accueilli : contactez-le avant de vous déplacer.';
  const falc = [`${e.nom} est : ${kind}.`, ...(where ? [`L’adresse est : ${where}.`] : []), ...(e.telephone ? [`Le téléphone est le ${e.telephone}.`] : []),
    'L’État confirme que ce lieu est ouvert.', 'Chaque lieu a ses règles pour accueillir.', 'Appelez avant d’y aller.'];
  return { resume, falc };
}

// --------------------------------------------------------------------------------------------------------------- the files of the day
/** the latest daily file of a FINESS+ dataset on data.gouv.fr: its address, the SHA-1 the publisher declares, its size and date @param {string} slug */
export async function latestDaily(slug, net = {}) {
  const r = await officialJson(`https://www.data.gouv.fr/api/1/datasets/${slug}/`, { ...net, timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 });
  const files = (r.json.resources || []).map((x) => ({ ...x, m: String(x.title || '').match(/journalier-(\d{8})\.json\.gz$/) })).filter((x) => x.m && x.url);
  if (!files.length) throw new SourceError('NO_DAILY_FILE', `Aucun fichier quotidien dans le jeu de données ${slug}.`);
  files.sort((a, b) => b.m[1].localeCompare(a.m[1]));
  const f = files[0];
  const sha1 = f.checksum && f.checksum.type === 'sha1' ? String(f.checksum.value).toLowerCase() : null;
  if (!sha1) throw new SourceError('NO_CHECKSUM', `Le fichier ${f.title} n’a pas d’empreinte publiée : il n’est pas utilisé.`);
  return { slug, title: f.title, url: f.url, sha1, bytes: Number(f.filesize) || null, date: `${f.m[1].slice(0, 4)}-${f.m[1].slice(4, 6)}-${f.m[1].slice(6, 8)}`, licence: r.json.license || null, publisher: r.json.organization?.name || null };
}

const sha1File = (file) => new Promise((resolve, reject) => { const h = crypto.createHash('sha1'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });

/**
 * The two files of the day in the cache directory (downloaded only when the publisher has a newer one, else the cached copy checked again): each file's
 * SHA-1 must be the publisher's, else it is not used. @param {{ cacheDir: string, net?: any, metaOnly?: boolean }} o
 */
export async function fetchFiness({ cacheDir, net = {} }) {
  if (!cacheDir) throw new SourceError('NO_CACHE_DIR', 'Répertoire de cache de la veille non configuré : FINESS n’est pas téléchargé (fichiers trop gros pour la mémoire).');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const out = {};
  for (const [key, slug] of Object.entries(DATASETS)) {
    const meta = await latestDaily(slug, net);
    const file = path.join(cacheDir, `finess-${key}.json.gz`); const metaFile = `${file}.json`;
    let cached = null; try { cached = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { cached = null; }
    const t0 = Date.now(); let reused = false;
    if (cached && cached.title === meta.title && cached.sha1 === meta.sha1 && fs.existsSync(file) && (await sha1File(file)) === meta.sha1) reused = true;
    else {
      const tmp = `${file}.part`;
      const d = await officialDownload(meta.url, tmp, { ...net, maxBytes: MAX_FILE_BYTES, timeoutMs: 15 * 60000, accept: 'application/gzip' });
      if (d.sha1 !== meta.sha1) { fs.rmSync(tmp, { force: true }); throw new SourceError('CHECKSUM_MISMATCH', `Fichier ${meta.title} : empreinte SHA-1 différente de celle publiée (téléchargement écarté).`, { expected: meta.sha1, got: d.sha1 }); }
      fs.renameSync(tmp, file); fs.writeFileSync(metaFile, JSON.stringify({ title: meta.title, sha1: meta.sha1, date: meta.date, bytes: d.bytes, sha256: d.sha256, fetchedAt: new Date().toISOString() }));
    }
    out[key] = { ...meta, file, reused, ms: Date.now() - t0 };
  }
  return out;
}

/**
 * Read the two files: the establishments of the département (all of them, open or closed, in scope or not: see establishmentsOf) with the publics of their
 * active activities, and the counts of the reading. Memory stays bounded: one legal entity at a time, a few thousand establishments kept.
 * @param {{ structures: string, activites?: string | null, departement?: string, limitEntities?: number }} files
 */
export async function readFiness({ structures, activites = null, departement = '67' }) {
  const byFiness = new Map(); let entities = 0;
  for await (const pm of arrayElements(gzipText(structures), 'pmej')) {
    entities += 1;
    for (const e of establishmentsOf(pm, departement)) byFiness.set(e.finess, e);
  }
  let withActivities = 0;
  if (activites) {
    for await (const pm of arrayElements(gzipText(activites), 'pmej')) {
      for (const g of pm.ege || []) {
        const e = byFiness.get(String(g.numFinessEge || '')); if (!e) continue;
        const p = activityPublics(g); if (p.length) { e.publics = [...new Set([...e.publics, ...p])]; withActivities += 1; }
      }
    }
  }
  const all = [...byFiness.values()];
  return { byFiness, entities, establishments: all.length, open: all.filter((e) => e.open).length, closed: all.filter((e) => !e.open).length,
    inScope: all.filter((e) => e.open && e.scope).length, withActivities };
}
