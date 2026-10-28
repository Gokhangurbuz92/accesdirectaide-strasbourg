// @ts-nocheck
/**
 * Automatic verification chain — data·inclusion (D05), the national open-data referential of the social and professional inclusion offer, published every week on
 * data.gouv.fr by the « Plateforme de l'inclusion » (GIP de l'inclusion, Licence Ouverte 2.0): the places (« structures ») and what they offer (« services »),
 * gathered from many PRODUCERS — public operators publishing their own offer (France Travail, the CNAF's monenfant.fr, the Carif-Oref, the FINESS register…) and
 * platforms where the places describe themselves (DORA, Ma Boussole Aidants, the Cartographie de la médiation numérique…).
 *
 *  - the export of the week is found through the data.gouv.fr API (the JSON files « structures-inclusion-<date>.json » and « services-inclusion-<date>.json »),
 *    downloaded as a stream and its SHA-1 compared with the one the publisher declares, read as a stream (one element at a time: the files are ~0.3 GB);
 *  - only the places of the département are kept, and of them only identity and place (no producer description, no telephone, no e-mail, no person's name):
 *    the IDENTITY of a place is always a registry's (SIRENE, the Annuaire de l'administration, FINESS — chain.js), never data·inclusion's;
 *  - each service keeps its ORIGINAL producer and that producer's actual authority (AUTHORITY): what a public operator publishes about its own offer is « selon
 *    France Travail »; what a place declared on a platform is « déclaré par la structure sur DORA ». Neither is presented as checked by the State;
 *  - labels are the schema's own (datainclusion-terms.js, pinned commit of the schema repository); an unknown value is counted and not shown;
 *  - a service not updated by its producer for more than FRESH_DAYS is not shown (no silent expiry: it is counted, and shown again when its producer updates it).
 * The restricted API (contacts, de-duplication, quality score) needs a token the data·inclusion team grants on request: apiStructures/apiServices are the
 * adapter, used only with DATA_INCLUSION_API_TOKEN set (docs/runbooks.md § 7 quater); the veille itself reads the open export.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline, PassThrough } from 'node:stream';
import { officialJson, officialDownload, SourceError } from './fetcher.js';
import { arrayElements, readableName } from './finess.js';
import TERMS from './datainclusion-terms.js';

export const DATASET = 'referentiel-de-loffre-dinsertion-sociale-et-professionnelle-data-inclusion';
export const DATASET_PAGE = `https://www.data.gouv.fr/datasets/${DATASET}`;
export const API_BASE = 'https://api.data.inclusion.gouv.fr';
const MAX_FILE_BYTES = 600 * 1024 * 1024;
/** a service its producer has not updated for two years is not shown */
export const FRESH_DAYS = 730;
/** at most this many services listed on one record (the most recently updated first) */
export const MAX_SERVICES = 30;

/**
 * The producers of data·inclusion and what their word is worth. OPERATEUR_PUBLIC: a public body (or its official register) publishing its own offer;
 * ORGANISME_GESTIONNAIRE: the body that runs the service publishes it; PLATEFORME_DECLARATIVE: the place itself declared it on a platform. A producer not listed
 * here is declarative (the most cautious reading). `growth`: the places of that producer may become new records (once a registry confirms them): monenfant.fr
 * lists childcare places (not the directory's scope), the Carif-Oref the VENUES of training sessions (mostly schools hosting a course), FINESS is read
 * directly from its register (finess.js) — their services are still listed on a record that already exists.
 */
export const PRODUCERS = {
  'france-travail': { label: 'France Travail', authority: 'OPERATEUR_PUBLIC', growth: true },
  monenfant: { label: 'monenfant.fr (Caisse nationale des allocations familiales)', authority: 'OPERATEUR_PUBLIC', growth: false },
  'carif-oref': { label: 'Carif-Oref Grand Est', authority: 'OPERATEUR_PUBLIC', growth: false },
  finess: { label: 'répertoire FINESS', authority: 'OPERATEUR_PUBLIC', growth: false },
  'emplois-de-linclusion': { label: 'les emplois de l’inclusion (Plateforme de l’inclusion)', authority: 'OPERATEUR_PUBLIC', growth: true },
  'action-logement': { label: 'Action Logement', authority: 'ORGANISME_GESTIONNAIRE', growth: true },
  dora: { label: 'DORA', authority: 'PLATEFORME_DECLARATIVE', growth: true },
  'ma-boussole-aidants': { label: 'Ma Boussole Aidants', authority: 'PLATEFORME_DECLARATIVE', growth: true },
  'mes-aides': { label: 'Mes Aides (France Travail)', authority: 'PLATEFORME_DECLARATIVE', growth: true },
  'mediation-numerique': { label: 'la Cartographie nationale des lieux d’inclusion numérique', authority: 'PLATEFORME_DECLARATIVE', growth: true },
  soliguide: { label: 'Soliguide', authority: 'PLATEFORME_DECLARATIVE', growth: true },
};
export function producerOf(source) {
  const p = PRODUCERS[String(source || '')];
  return p ? { id: String(source), ...p } : { id: String(source || 'inconnu'), label: String(source || 'source inconnue'), authority: 'PLATEFORME_DECLARATIVE', growth: false };
}
/** the public words of an attribution (StructureDetail shows them next to each service) */
export const attribution = (p) => (p.authority === 'PLATEFORME_DECLARATIVE' ? `déclaré par la structure sur ${p.label}` : p.authority === 'ORGANISME_GESTIONNAIRE' ? `selon ${p.label}, qui gère ce service` : `selon ${p.label}`);

/** the directory's categories (categories_aidees, need-fallback.js) of the schema's thématiques */
export const CATEGORY_OF_THEME = {
  'choisir-un-metier': 'Emploi', 'creer-une-entreprise': 'Emploi', 'preparer-sa-candidature': 'Emploi', 'trouver-un-emploi': 'Emploi', 'souvrir-a-linternational': 'Emploi',
  'se-former': 'Formation', 'lecture-ecriture-calcul': 'Savoirs de base', 'difficultes-administratives-ou-juridiques': 'Accès aux droits', 'difficultes-financieres': 'Budget',
  'equipement-et-alimentation': 'Alimentation et équipement', famille: 'Famille', 'logement-hebergement': 'Logement', mobilite: 'Mobilité', numerique: 'Numérique',
  remobilisation: 'Lien social et remobilisation', sante: 'Santé',
};
/** a school or a generic name is not a place people turn to for help (a training venue, « Établissement scolaire »): never a new record */
export const NOT_A_PLACE_NAME = /^(?:[ée]tablissement scolaire|groupe scolaire|[ée]cole|coll[èe]ge|lyc[ée]e|universit[ée]|si[èe]ge)(?!\p{L})/iu;
export const termsVersion = () => ({ schema: TERMS.schema, commit: TERMS.commit });
const label = (list, v) => TERMS.lists[list]?.[String(v)] ?? null;

// --------------------------------------------------------------------------------------------------------------- identity helpers
const digitsOnly = (s) => String(s || '').replace(/\D/g, '');
/** a well-formed SIRET (14 digits, Luhn key; La Poste's establishments have their own rule) — data·inclusion's SIRET is the producer's, a registry confirms it */
export function validSiret(s) {
  const d = digitsOnly(s);
  if (d.length !== 14) return null;
  if (d.startsWith('356000000')) return [...d].reduce((a, c) => a + Number(c), 0) % 5 === 0 ? d : null;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) { let n = Number(d[13 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0 ? d : null;
}
const isoDay = (v) => { if (v === null || v === undefined || v === '') return null; const t = typeof v === 'number' ? new Date(v) : new Date(String(v)); return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10); };
const httpsUrl = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.toString() : null; } catch { return null; } };
const inDept = (s, dept) => String(s.code_insee || '').startsWith(dept) || (!s.code_insee && String(s.code_postal || '').startsWith(dept));

// --------------------------------------------------------------------------------------------------------------- the export of the week
/** the latest export with BOTH JSON files and their published SHA-1 */
export async function latestExport(net = {}) {
  const r = await officialJson(`https://www.data.gouv.fr/api/1/datasets/${DATASET}/`, { ...net, timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 });
  const files = {};
  for (const x of r.json.resources || []) {
    const m = String(x.title || '').match(/^(structures|services)-inclusion-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m || !x.url) continue;
    (files[m[2]] = files[m[2]] || {})[m[1]] = x;
  }
  const date = Object.keys(files).filter((d) => files[d].structures && files[d].services).sort().pop();
  if (!date) throw new SourceError('NO_EXPORT', 'Aucun export data·inclusion complet (structures et services) sur data.gouv.fr.');
  const meta = (x) => {
    const sha1 = x.checksum && x.checksum.type === 'sha1' ? String(x.checksum.value).toLowerCase() : null;
    if (!sha1) throw new SourceError('NO_CHECKSUM', `Le fichier ${x.title} n’a pas d’empreinte publiée : il n’est pas utilisé.`);
    return { title: x.title, url: x.url, sha1, bytes: Number(x.filesize) || null, modifiedAt: x.last_modified || null };
  };
  return { date, structures: meta(files[date].structures), services: meta(files[date].services), licence: r.json.license || null, publisher: r.json.organization?.name || null,
    frequency: r.json.frequency || null, datasetUpdatedAt: r.json.last_update || null };
}

const sha1File = (file) => new Promise((resolve, reject) => { const h = crypto.createHash('sha1'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });

/** the two files of the export in the cache directory (downloaded only when the publisher has a newer one; the cached copy is checked again) */
export async function fetchDataInclusion({ cacheDir, net = {} }) {
  if (!cacheDir) throw new SourceError('NO_CACHE_DIR', 'Répertoire de cache de la veille non configuré : data·inclusion n’est pas téléchargé (fichiers trop gros pour la mémoire).');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const ex = await latestExport(net);
  const out = { date: ex.date, licence: ex.licence, publisher: ex.publisher, frequency: ex.frequency };
  for (const key of ['structures', 'services']) {
    const meta = ex[key]; const file = path.join(cacheDir, `datainclusion-${key}.json`); const metaFile = `${file}.meta.json`;
    let cached = null; try { cached = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { cached = null; }
    const t0 = Date.now(); let reused = false;
    if (cached && cached.title === meta.title && cached.sha1 === meta.sha1 && fs.existsSync(file) && (await sha1File(file)) === meta.sha1) reused = true;
    else {
      const tmp = `${file}.part`;
      const d = await officialDownload(meta.url, tmp, { ...net, maxBytes: MAX_FILE_BYTES, timeoutMs: 15 * 60000, accept: 'application/json' });
      if (d.sha1 !== meta.sha1) { fs.rmSync(tmp, { force: true }); throw new SourceError('CHECKSUM_MISMATCH', `Fichier ${meta.title} : empreinte SHA-1 différente de celle publiée (téléchargement écarté).`, { expected: meta.sha1, got: d.sha1 }); }
      fs.renameSync(tmp, file); fs.writeFileSync(metaFile, JSON.stringify({ title: meta.title, sha1: meta.sha1, date: ex.date, bytes: d.bytes, sha256: d.sha256, fetchedAt: new Date().toISOString() }));
    }
    out[key] = { ...meta, file, reused, ms: Date.now() - t0 };
  }
  return out;
}

/** the text chunks of a JSON file (UTF-8 decoded across chunk boundaries; a read error ends the reading with that error) @param {string} file */
export function jsonText(file) {
  const out = new PassThrough({ highWaterMark: 1 << 20 });
  pipeline(fs.createReadStream(file, { highWaterMark: 1 << 20 }), out, (e) => { if (e) out.destroy(e); });
  out.setEncoding('utf8');
  return out;
}

// --------------------------------------------------------------------------------------------------------------- reading
/** what is kept of a place: identity and location only (no description, no telephone, no e-mail) */
function placeOf(s) {
  return { id: String(s.id), source: String(s.source || ''), nom: readableName(String(s.nom || '').replace(/\s+/g, ' ').trim()).slice(0, 200), siret: validSiret(s.siret),
    adresse: s.adresse ? String(s.adresse).replace(/\s+/g, ' ').trim().slice(0, 200) : null, code_postal: s.code_postal ? String(s.code_postal).trim() : null,
    commune: s.commune ? String(s.commune).trim() : null, code_insee: s.code_insee ? String(s.code_insee).trim() : null,
    latitude: Number.isFinite(Number(s.latitude)) && s.latitude !== null ? Number(s.latitude) : null, longitude: Number.isFinite(Number(s.longitude)) && s.longitude !== null ? Number(s.longitude) : null,
    updatedAt: isoDay(s.date_maj), link: httpsUrl(s.lien_source), finess: String(s.source) === 'finess' ? (String(s.id).split('--')[1] || null) : null };
}

/**
 * One service in the directory's words: the schema's labels only (never the producer's free text: description, conditions, contact), its producer and that
 * producer's authority, its date, the link to the producer's page. `unknown` collects the values missing from the referentials (counted, not shown).
 */
export function serviceOf(v, unknown = null) {
  const miss = (k, x) => { if (unknown) unknown[`${k}:${x}`] = (unknown[`${k}:${x}`] || 0) + 1; };
  const p = producerOf(v.source);
  const themes = []; const categories = new Set();
  for (const t of Array.isArray(v.thematiques) ? v.thematiques : []) {
    const l = label('thematiques', t); if (!l) { miss('thematique', t); continue; }
    themes.push(l); const c = CATEGORY_OF_THEME[String(t).split('--')[0]]; if (c) categories.add(c);
  }
  const publics = (Array.isArray(v.publics) ? v.publics : []).map((x) => label('publics', x) || (miss('public', x), null)).filter(Boolean);
  const modes = (Array.isArray(v.modes_accueil) ? v.modes_accueil : []).map((x) => label('modesAccueil', x) || (miss('mode', x), null)).filter(Boolean);
  const frais = v.frais ? (label('frais', v.frais) || (miss('frais', v.frais), null)) : null;
  const type = v.type ? (label('types', v.type) || (miss('type', v.type), null)) : null;
  const nom = String(v.nom || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return { id: String(v.id), nom, producer: p.id, producerLabel: p.label, authority: p.authority, attribution: attribution(p), type, themes: [...new Set(themes)].slice(0, 6),
    categories: [...categories], publics: [...new Set(publics)].slice(0, 6), frais, modes, updatedAt: isoDay(v.date_maj), link: httpsUrl(v.lien_source) };
}

/**
 * Read the export: the places of the département and their services, as a stream (memory bounded by the places kept — about a thousand for the Bas-Rhin).
 * @param {{ structures: string, services: string, departement?: string }} files
 */
export async function readDataInclusion({ structures, services, departement = '67' }) {
  const places = new Map(); let total = 0; const bySource = {};
  for await (const s of arrayElements(jsonText(structures), null)) {
    total += 1;
    if (!s || !s.id || !inDept(s, departement)) continue;
    const p = placeOf(s); places.set(p.id, p); bySource[p.source] = (bySource[p.source] || 0) + 1;
  }
  const servicesOf = new Map(); let servicesTotal = 0; let kept = 0; const unknown = {};
  for await (const v of arrayElements(jsonText(services), null)) {
    servicesTotal += 1;
    if (!v || !places.has(String(v.structure_id))) continue;
    const list = servicesOf.get(String(v.structure_id)) || []; list.push(serviceOf(v, unknown)); servicesOf.set(String(v.structure_id), list); kept += 1;
  }
  return { places, servicesOf, counts: { structures: total, inScope: places.size, withSiret: [...places.values()].filter((p) => p.siret).length, services: servicesTotal, servicesInScope: kept, bySource }, unknown };
}

/**
 * The services of one record (all the places of data·inclusion that are this record), fresh ones first: the same service named by two producers is listed once,
 * with the producer of the highest authority. `asOf`: the export's date (freshness is the producer's date against the export's, not the clock's).
 */
export function servicesFor(placeList, servicesOf, { asOf }) {
  const rank = { OPERATEUR_PUBLIC: 0, ORGANISME_GESTIONNAIRE: 1, PLATEFORME_DECLARATIVE: 2 };
  const limit = asOf ? new Date(`${asOf}T00:00:00Z`).getTime() - FRESH_DAYS * 86400000 : -Infinity;
  const all = placeList.flatMap((p) => servicesOf.get(p.id) || []);
  const fresh = all.filter((s) => s.updatedAt && new Date(`${s.updatedAt}T00:00:00Z`).getTime() >= limit && s.nom);
  const key = (s) => `${s.nom.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim()}|${s.themes.join(',')}`;
  const best = new Map();
  for (const s of fresh) { const k = key(s); const b = best.get(k); if (!b || rank[s.authority] < rank[b.authority] || (rank[s.authority] === rank[b.authority] && s.updatedAt > b.updatedAt)) best.set(k, s); }
  const list = [...best.values()].sort((a, b) => rank[a.authority] - rank[b.authority] || String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.nom.localeCompare(b.nom)).slice(0, MAX_SERVICES);
  return { services: list, stale: all.length - fresh.length, duplicates: fresh.length - best.size };
}

/**
 * The value of Structure.services_externes for a record: the export, its licence, the places of data·inclusion that are this record (producer and id), the
 * services, the directory's categories they cover. `previous` carries the record's history with data·inclusion (created from it; exports it was missing from).
 */
export function servicesValue({ version, placeList, servicesOf, previous = null, created = false }) {
  const s = servicesFor(placeList, servicesOf, { asOf: version });
  const categories = [...new Set(s.services.flatMap((x) => x.categories))].sort();
  return { origin: 'DATA_INCLUSION', export: version, dataset: DATASET_PAGE, licence: 'Licence Ouverte 2.0', schema: `data·inclusion ${TERMS.schema}`,
    places: placeList.map((p) => ({ id: p.id, producer: p.source, link: p.link })).sort((a, b) => a.id.localeCompare(b.id)),
    services: s.services, categories, staleServices: s.stale, createdFromDataInclusion: Boolean(created || previous?.createdFromDataInclusion), absentFrom: [] };
}
/** a JSON text independent of the order of keys (PostgreSQL's jsonb stores them in its own order) */
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
/** the content that matters (the export date and bookkeeping aside): unchanged → no new version of the record */
export const sameServices = (a, b) => canonical(a ? { p: a.places, s: a.services, c: a.categories } : null) === canonical(b ? { p: b.places, s: b.services, c: b.categories } : null);

/** the public part of services_externes (StructureDetail): the services with their attribution and the export they come from; nothing internal */
export function publicServices(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.services) || !v.services.length) return null;
  return { export: v.export || null, dataset: v.dataset || DATASET_PAGE, licence: v.licence || null,
    services: v.services.map((s) => ({ nom: s.nom, type: s.type || null, themes: s.themes || [], publics: s.publics || [], frais: s.frais || null, modes: s.modes || [],
      producer: s.producerLabel || null, authority: s.authority || null, attribution: s.attribution || null, updatedAt: s.updatedAt || null, link: s.link || null })) };
}

// --------------------------------------------------------------------------------------------------------------- optional restricted API
/**
 * The data·inclusion API (https://api.data.inclusion.gouv.fr/api/v1, Bearer token granted by the data·inclusion team on request — see the runbook). Same schema
 * as the export, plus contacts, de-duplication and a quality score; used only when DATA_INCLUSION_API_TOKEN is set. The contacts it returns are NEVER kept:
 * placeOf / serviceOf keep the same fields as from the export. Returns { ok: false, code: 'NO_TOKEN' } without a token (nothing is requested).
 */
async function apiPages(pathname, { env = process.env, departement = '67', fetchImpl = fetch, size = 1000, maxPages = 50, extra = {} } = {}) {
  const token = env.DATA_INCLUSION_API_TOKEN;
  if (!token) return { ok: false, code: 'NO_TOKEN', message: 'API data·inclusion non configurée (DATA_INCLUSION_API_TOKEN absent) : l’export ouvert est utilisé.' };
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const q = new URLSearchParams({ code_departement: departement, page: String(page), size: String(size), ...extra });
    const r = await fetchImpl(`${API_BASE}${pathname}?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'TOKEN_REFUSED', message: `API data·inclusion : jeton refusé (réponse ${r.status}).` };
    if (!r.ok) return { ok: false, code: 'API_ERROR', message: `API data·inclusion : réponse ${r.status}.` };
    const j = await r.json();
    items.push(...(j.items || []));
    if (!j.pages || page >= j.pages) return { ok: true, items, total: j.total ?? items.length };
  }
  return { ok: false, code: 'TOO_MANY_PAGES', message: 'API data·inclusion : plus de pages que prévu, lecture arrêtée.' };
}
export async function apiStructures(opts = {}) { const r = await apiPages('/api/v1/structures', { ...opts, extra: { exclure_doublons: 'false' } }); return r.ok ? { ...r, items: r.items.filter((s) => inDept(s, opts.departement || '67')).map(placeOf) } : r; }
export async function apiServices(opts = {}) { const r = await apiPages('/api/v1/services', opts); return r.ok ? { ...r, items: r.items.map((v) => ({ structureId: String(v.structure_id), service: serviceOf(v) })) } : r; }
