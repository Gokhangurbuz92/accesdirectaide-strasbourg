// @ts-nocheck
/**
 * G14-RG (owner approval 23/11/2026, « tek kapı / guichet unique ») — life situations → needs → rights → démarches → structure types, resolved IN THE
 * BROWSER from bundled, already-sourced reference files. Nothing here makes a request, stores anything or logs the text a person types.
 *
 *   data/reference/life-situations.v1.json   the curated situations (ids only — no right, amount, condition or deadline is written there)
 *   data/reference/rights-public-view.v1.json the public Rights Graph view (needs, official fiches with DILA dates; owner decision C4: no D11 rule)
 *   data/reference/parcours-step-types.v1.json the closed Mon Parcours list (codes, labels, official sources with dates)
 *   data/reference/social-domains.v1.json      the 20 × 86 catalogue, its structure types and the emergency numbers
 *   data/reference/guide-offices.v1.json        the « Où s'adresser » types of the fiches (DILA)
 *   data/rules/rights-graph-sources.v1.json     the Rights Graph source ledger (DILA fiches with their dates, archive read 2026-11-18): titles and dates
 *                                              only — no D11 rule, condition or LEGI article is read from it (owner decision C4)
 *
 * Fail closed: an id that does not resolve to a sourced record is dropped (and the unit test fails on it), so nothing unsourced is ever shown.
 * The free-text matching is deterministic (normalised keywords / synonyms of the six interface languages): no AI, no server, no storage.
 */
import situationsFile from '../../data/reference/life-situations.v1.json';
import steps from '../../data/reference/parcours-step-types.v1.json';
import reference from '../../data/reference/social-domains.v1.json';
import offices from '../../data/reference/guide-offices.v1.json';
import ledger from '../../data/rules/rights-graph-sources.v1.json';
import { FICHES, NEEDS } from './rightsPublicView.js';

/** @typedef {{ id: string, title: string | null, url: string, modifiedAt: string | null, readAt: string | null, origin: 'rights-view' | 'parcours-list' | 'rights-graph-sources' }} SourcedFiche */

export const EMERGENCY_NUMBERS = Object.freeze({ ...reference.emergency });
export const STEP_TYPES = new Map(steps.types.map((t) => [t.code, t]));
const NEED_BY_ID = new Map(NEEDS.map((n) => [n.id, n]));
const SUBDOMAINS = new Set(reference.domains.flatMap((d) => d.subdomains.map((s) => `${d.id}/${s.id}`)));

/** every structure type the directory filter can be given: catalogue types, « Où s'adresser » types, Mon Parcours structure kinds */
export const STRUCTURE_TYPES = new Set([
  ...reference.domains.flatMap((d) => d.subdomains.flatMap((s) => s.structureTypes || [])),
  ...Object.values(offices.sheets).flatMap((s) => s.types || []),
  ...Object.values(steps.structureKinds).flatMap((k) => k.typeStructure || []),
]);

/** an official fiche with its dates: from the public Rights Graph view first, else from the sources of the Mon Parcours list; null when unsourced @returns {SourcedFiche | null} */
export function sourcedFiche(id) {
  const f = FICHES.get(id);
  if (f && (f.modifiedAt || f.importantChangeAt) && f.readAt) {
    return { id, title: f.title, url: f.url, modifiedAt: f.modifiedAt || f.importantChangeAt, readAt: f.readAt, origin: 'rights-view' };
  }
  for (const t of steps.types) {
    const s = t.sources.find((x) => x.id === id);
    if (s && s.modified) return { id, title: s.title, url: s.url, modifiedAt: s.modified, readAt: steps.readAt, origin: 'parcours-list' };
  }
  const g = ledger.fiches.find((x) => x.id === id);
  if (g && g.present === true && !g.redirectedTo && (g.modifiedAt || g.importantChangeAt) && /^[FN]\d{1,6}$/.test(id)) {
    return { id, title: g.title, url: `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`, modifiedAt: g.modifiedAt || g.importantChangeAt, readAt: ledger.archive.readAt, origin: 'rights-graph-sources' };
  }
  return null;
}

/** a step: a code of the closed Mon Parcours list (with its sources) or an official fiche; null when it does not resolve */
function resolveStep(s) {
  if (s && typeof s.stepType === 'string') {
    const t = STEP_TYPES.get(s.stepType);
    if (!t) return null;
    const sources = t.sources.map((x) => sourcedFiche(x.id)).filter(Boolean);
    return sources.length ? { kind: 'stepType', code: t.code, label: t.label, domain: t.domain, sources } : null;
  }
  if (s && typeof s.fiche === 'string') {
    const f = sourcedFiche(s.fiche);
    return f ? { kind: 'fiche', fiche: f } : null;
  }
  return null;
}

/** one situation with every link resolved (unsourced links dropped) */
function resolve(raw) {
  const needs = raw.needs.map((id) => NEED_BY_ID.get(id)).filter(Boolean);
  const rights = raw.rights.map(sourcedFiche).filter(Boolean);
  const resolvedSteps = raw.steps.map(resolveStep).filter(Boolean);
  const bodies = [];
  for (const n of needs) for (const b of n.bodies) if (!bodies.some((x) => x.id === b.id)) bodies.push(b);
  return {
    id: raw.id,
    family: raw.family,
    danger: raw.danger === true,
    emergency: raw.emergency.filter((x) => Object.prototype.hasOwnProperty.call(EMERGENCY_NUMBERS, x)),
    subdomains: raw.subdomains.filter((x) => SUBDOMAINS.has(x)),
    needs,
    rights,
    steps: resolvedSteps,
    structures: raw.structures.filter((x) => STRUCTURE_TYPES.has(x)),
    bodies,
    keywords: raw.keywords,
  };
}

export const RAW_SITUATIONS = situationsFile.situations;
/** the groups of the /situation index, in their order */
export const FAMILIES = Object.freeze([...situationsFile.families]);
export const SITUATIONS = Object.freeze(RAW_SITUATIONS.map(resolve));
export const SITUATION_BY_ID = new Map(SITUATIONS.map((s) => [s.id, s]));
/** the source of the emergency numbers (fiche « Quels sont les numéros en cas d'urgence… ») */
export const EMERGENCY_FICHE = sourcedFiche(situationsFile.emergencySource);

// ── free-text matching (browser only, deterministic) ─────────────────────────────────────────────────────────────────────────────
const AR_PROCLITICS = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ل'];
/** an Arabic word without its common proclitics (« الإيجار » → « ايجار »), only when at least three letters remain */
const arStem = (w) => {
  for (const p of AR_PROCLITICS) if (w.startsWith(p) && w.length - p.length >= 3) return w.slice(p.length);
  return w;
};

/**
 * Normalises a text for matching: lower case, no accents or Arabic diacritics, one alef/yeh/teh form, ß → ss, dotless ı → i, punctuation and apostrophes
 * become spaces, Arabic proclitics are dropped. Applied the same way to the keywords and to the typed text. @param {string} text @returns {string}
 */
export function normalise(text) {
  const base = String(text || '').slice(0, 500).toLowerCase().replace(/ß/g, 'ss').replace(/ı/g, 'i')
    .normalize('NFKD').replace(/\p{M}/gu, '').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return base.split(' ').map((w) => (/[؀-ۿ]/.test(w) ? arStem(w) : w)).join(' ');
}

/**
 * a keyword is found at the start of a word; a short keyword must be the whole word, a longer one may be a stem (« loyer » → « loyers »). Short means
 * under five letters, or under four in Arabic script (its words are shorter once the proclitics are dropped: « طعام » → « طعاما »)
 */
const found = (text, kw) => {
  const padded = ` ${text} `;
  const min = /[\u0600-\u06FF]/.test(kw) ? 4 : 5;
  if (kw.length < min) return padded.includes(` ${kw} `);
  return padded.includes(` ${kw}`);
};

const KEYWORDS = SITUATIONS.map((s) => ({ id: s.id, danger: s.danger, words: [...new Set(Object.values(s.keywords).flat().map(normalise).filter(Boolean))] }));

/**
 * The situations a typed text points to, best first; a situation that implies danger comes first whenever it matches. Pure and local: the text is not
 * kept anywhere. @param {string} text @param {number} [limit] @returns {{ id: string, danger: boolean, score: number }[]}
 */
export function matchSituations(text, limit = 4) {
  const t = normalise(text);
  if (t.length < 2) return [];
  const hits = [];
  for (const k of KEYWORDS) {
    let score = 0;
    for (const w of k.words) if (found(t, w)) score += w.length;
    if (score > 0) hits.push({ id: k.id, danger: k.danger, score });
  }
  return hits.sort((a, b) => Number(b.danger) - Number(a.danger) || b.score - a.score).slice(0, limit);
}

/** the directory, filtered on a structure type and (when chosen) a commune; with `bookable`, only the places that can be asked online (G14-FIND filter) */
export function directoryHref(type, commune = '', bookable = false) {
  const p = new URLSearchParams();
  p.set('type', type);
  if (commune) p.set('city', commune);
  if (bookable) p.set('bookable', '1');
  return `/structures?${p}`;
}

/**
 * The search of the /situation index: the keyword matcher, plus the situations whose name in the interface language contains the typed words
 * (so a person finds what they read on the list, in any of the six languages). Local and pure, like matchSituations.
 * @param {string} text @param {(id: string) => string} labelOf @param {number} [limit] @returns {{ id: string, danger: boolean, score: number }[]}
 */
export function searchSituations(text, labelOf, limit = 6) {
  const hits = matchSituations(text, SITUATIONS.length);
  const t = normalise(text);
  if (t.length >= 3) {
    for (const s of SITUATIONS) {
      if (!hits.some((h) => h.id === s.id) && normalise(labelOf(s.id)).includes(t)) hits.push({ id: s.id, danger: s.danger, score: t.length });
    }
  }
  return hits.sort((a, b) => Number(b.danger) - Number(a.danger) || b.score - a.score).slice(0, limit);
}
