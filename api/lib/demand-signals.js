// @ts-check
/**
 * G14-OBS (owner approval 23/11/2026, « Observatoire du non-recours ») — the REGISTRY and the PUBLICATION RULES of the anonymous demand signals.
 * Pure (no database): read by the recording service (api/_services/demand-signals.js), the public handlers, the tests and the report.
 *
 * What a demand signal is: one anonymous count, at the moment something happens on the site, of a CODE from a closed list — never a person, never a text.
 *   search_need      a search whose words the server's own deterministic reading (api/lib/multi-need.js analyseNeeds) placed in a subdomain of the
 *                    20 × 86 reference (data/reference/social-domains.v1.json); + the Eurométropole commune of the search's territory filter, if any —
 *                    EXCEPT for a sensitive subdomain (api/lib/parcours-sensitivity.js SENSITIVE_NEEDS): its commune is dropped before counting.
 *   search_category  the aid-category filter of a search (AidCategoryCode), without commune.
 *   situation        a Rights Graph situation (/situation) chosen by a visitor who ticked the opt-in box (consent-like opt-in: the page otherwise sends nothing).
 *   parcours_added   a step of the LIMITED Mon Parcours added (its step-type code, data/reference/parcours-step-types.v1.json).
 *   parcours_closed  such a step moved to a final state (closed, decision received) — self-declared by the person, never verified.
 *   social_referral  the closed reasons of a social referral sent (branch g14-ps, when it lands).
 * Never recorded: the words typed, a user id, an IP address, a session, the time of day, a free text, a referrer. The raw text of a search is read by
 * the search itself, as before; only the resulting codes reach the counter.
 *
 * Two switches, both CLOSED by default and exact:
 *   ADA_DEMAND_SIGNALS   comma list of the families recorded: search, situation, parcours, referral (unset = nothing is ever written).
 *   ADA_OBSERVATOIRE     « open » = GET /api/public/observatoire answers (else 404). VITE_OBSERVATOIRE=open shows the page content.
 *
 * Publication (closed calendar quarters only, frozen once, then the daily counts are deleted):
 *   - a cell below K_MIN (5, the observatory threshold decided by the owner, D4/C8) is published masked (null), zero included;
 *   - complementary suppression inside each column (a single masked cell is never left alone), and between the two marginal tables that count the same
 *     searches (by subdomain, by commune) with the C8 bound protection (api/_services/territorial-stats.js protectMarginals);
 *   - a domain gets a commune table only when its quarter count reaches COMMUNE_TABLE_MIN (20): commune × rare category is never broken down;
 *   - every closed-list code is always listed (so a listed row says nothing about existence), and every total is a SUM OF PUBLISHED CELLS.
 * These are disclosure-control heuristics (as for C8), not a proof of anonymity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SENSITIVE_NEEDS } from './parcours-sensitivity.js';

export const SCHEMA = 'ada.observatoire.v1';
export const QUARTER_SCHEMA = 'ada.observatoire-demand-quarter.v1';
export const OBSERVATOIRE_PATH = 'public/observatoire';
export const SIGNAL_PATH = 'public/signal';
/** the observatory threshold (owner D4 / C8: k = 5) — same value as api/_services/org-stats.js K_MIN, asserted by the tests */
export const K_MIN = 5;
/** a domain's searches are broken down by commune only from this quarter count on */
export const COMMUNE_TABLE_MIN = 20;
/** Eurométropole de Strasbourg (INSEE EPCI code) */
export const EMS_EPCI = '246700488';
/** a search whose territory is outside the Eurométropole */
export const OUTSIDE = 'HORS';
/** the licence of the open data (Etalab Licence Ouverte 2.0, SPDX identifier) */
export const LICENCE = 'etalab-2.0';

export const SIGNALS = Object.freeze(['search_need', 'search_category', 'situation', 'parcours_added', 'parcours_closed', 'social_referral']);
/** family named in ADA_DEMAND_SIGNALS → its signals */
export const FAMILIES = Object.freeze({ search: ['search_need', 'search_category'], situation: ['situation'], parcours: ['parcours_added', 'parcours_closed'], referral: ['social_referral'] });

/** AidCategoryCode (src/db/schema.ts) — kept here so this module needs no database import; the tests compare both lists */
export const AID_CATEGORIES = Object.freeze(['LOGEMENT', 'SANTE', 'HANDICAP', 'EMPLOI', 'FAMILLE', 'ETUDES', 'MOBILITE', 'ENERGIE', 'ALIMENTATION', 'JUSTICE', 'NUMERIQUE', 'AUTRE']);

/**
 * The Rights Graph situations (data/reference/life-situations.v1.json, 74 since g14-rg) and the social domain each one is about (its first subdomain's
 * domain). Mirrored here (a frozen closed list, no file read on the request path); the tests compare both. `sensitive`: one of its subdomains is in the
 * violence, child protection, mental health, disability or migration domain, or is a sensitive need (api/lib/parcours-sensitivity.js SENSITIVE_NEEDS) — counted only territory-wide, like every situation (no commune is ever sent).
 */
export const SITUATIONS = Object.freeze({
  'loyer-impaye': { domain: 'logement' }, expulsion: { domain: 'logement' }, 'sans-logement': { domain: 'logement' },
  'factures-impayees': { domain: 'precarite' }, 'logement-insalubre': { domain: 'logement' }, 'recherche-hlm': { domain: 'logement' },
  'heberge-chez-tiers': { domain: 'logement' }, 'logement-jeune': { domain: 'logement' }, 'adapter-logement': { domain: 'logement', sensitive: true },
  'perte-emploi': { domain: 'emploi' }, 'fin-de-droits': { domain: 'precarite' }, 'faibles-revenus': { domain: 'precarite' },
  'sans-ressources': { domain: 'precarite' }, 'retour-emploi': { domain: 'emploi' }, 'formation-reconversion': { domain: 'emploi' },
  dettes: { domain: 'budget' }, 'budget-difficile': { domain: 'budget' }, 'compte-bancaire': { domain: 'budget' }, impots: { domain: 'budget' },
  'aide-alimentaire': { domain: 'precarite' }, naissance: { domain: 'famille', sensitive: true }, separation: { domain: 'famille' },
  'parent-seul': { domain: 'famille' }, 'garde-enfant': { domain: 'famille' }, 'enfants-a-charge': { domain: 'famille' },
  parentalite: { domain: 'famille', sensitive: true }, 'deces-proche': { domain: 'transversal' }, aidant: { domain: 'lien-social' },
  'enfant-danger': { domain: 'protection-enfance', sensitive: true }, 'mineur-isole': { domain: 'protection-enfance', sensitive: true },
  'sortie-ase': { domain: 'protection-enfance', sensitive: true }, 'jeune-sans-emploi': { domain: 'enfance-jeunesse' },
  'etudiant-difficulte': { domain: 'enfance-jeunesse' }, scolarite: { domain: 'enfance-jeunesse', sensitive: true },
  'jeune-loisirs': { domain: 'lien-social' }, handicap: { domain: 'handicap', sensitive: true }, 'enfant-handicap': { domain: 'handicap', sensitive: true },
  'handicap-travail': { domain: 'handicap', sensitive: true }, 'handicap-hebergement': { domain: 'handicap', sensitive: true },
  'sans-couverture-sante': { domain: 'sante', sensitive: true }, 'sante-sexuelle': { domain: 'sante', sensitive: true },
  'souffrance-psy': { domain: 'sante-mentale', sensitive: true }, detresse: { domain: 'sante-mentale', sensitive: true },
  addiction: { domain: 'sante-mentale', sensitive: true }, 'fin-de-vie': { domain: 'autonomie', sensitive: true },
  'proche-age': { domain: 'autonomie', sensitive: true }, 'maison-retraite': { domain: 'autonomie', sensitive: true },
  'maltraitance-agee': { domain: 'autonomie', sensitive: true }, retraite: { domain: 'autonomie', sensitive: true },
  violences: { domain: 'violences', sensitive: true }, 'violences-sexuelles': { domain: 'violences', sensitive: true },
  victime: { domain: 'violences', sensitive: true }, harcelement: { domain: 'violences', sensitive: true },
  exploitation: { domain: 'violences', sensitive: true }, 'arrivee-strasbourg': { domain: 'transversal' },
  'titre-sejour': { domain: 'migration', sensitive: true }, 'demande-asile': { domain: 'migration', sensitive: true },
  'protection-temporaire': { domain: 'migration', sensitive: true }, 'apprendre-francais': { domain: 'migration', sensitive: true },
  'sans-titre-sejour': { domain: 'migration', sensitive: true }, litige: { domain: 'justice' }, 'contester-decision': { domain: 'justice' },
  'sortie-detention': { domain: 'justice', sensitive: true }, 'protection-majeur': { domain: 'protection-majeurs', sensitive: true },
  discrimination: { domain: 'discrimination', sensitive: true }, 'demarches-papiers': { domain: 'precarite' }, 'pas-internet': { domain: 'numerique' },
  'lire-ecrire': { domain: 'numerique' }, 'papiers-perdus': { domain: 'precarite' }, demenagement: { domain: 'transversal' },
  'transport-cout': { domain: 'mobilite' }, 'permis-mobilite': { domain: 'mobilite' }, 'transport-adapte': { domain: 'mobilite', sensitive: true },
  isolement: { domain: 'lien-social' }
});

/** the closed reasons of the social referral (branch g14-ps, api/lib/social-referral-policy.js SOCIAL_REASONS) — mirrored, compared by the tests when present */
export const SOCIAL_REFERRAL_REASONS = Object.freeze(['HOUSING', 'EMPLOYMENT', 'TRAINING', 'INCOME_BUDGET', 'ENERGY', 'ADMIN_PROCEDURES', 'ACCESS_TO_RIGHTS', 'MOBILITY', 'DIGITAL', 'FOOD']);

/* ------------------------------------------------------------------------------------------------------------------------------------- reference files */

/** @typedef {{ id: string, domain: string, sensitive: boolean, structureTypes: string[] }} Subdomain */
/** @type {{ domains: string[], subdomains: Map<string, Subdomain> } | null} */
let reference = null;
/** the 20 domains and 86 subdomains (data/reference/social-domains.v1.json) */
export function socialReference(root = process.cwd()) {
  if (reference) return reference;
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/reference/social-domains.v1.json'), 'utf8'));
  const subdomains = new Map();
  for (const d of raw.domains) for (const s of d.subdomains) subdomains.set(String(s.id), { id: String(s.id), domain: String(d.id), sensitive: Object.prototype.hasOwnProperty.call(SENSITIVE_NEEDS, s.id), structureTypes: [...(s.structureTypes || [])] });
  /** @type {{ domains: string[], subdomains: Map<string, Subdomain> }} */
  const out = { domains: raw.domains.map((/** @type {any} */ d) => String(d.id)), subdomains };
  reference = out;
  return out;
}

/** @type {Array<{ code: string, domain: string }> | null} */
let steps = null;
/** the step types of the limited Mon Parcours (code, its own domain) */
export function parcoursStepCodes(root = process.cwd()) {
  if (steps) return steps;
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/reference/parcours-step-types.v1.json'), 'utf8'));
  /** @type {Array<{ code: string, domain: string }>} */
  const out = raw.types.map((/** @type {any} */ t) => ({ code: String(t.code), domain: String(t.domain) }));
  steps = out;
  return out;
}

/** @type {Array<{ code: string, nom: string }> | null} */
let ems = null;
/** the 33 communes of the Eurométropole (INSEE 2026 reference), by name */
export function emsCommunes(root = process.cwd()) {
  if (ems) return ems;
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/geography/insee-2026.v1.json'), 'utf8'));
  /** @type {Array<{ code: string, nom: string }>} */
  const out = raw.communes.filter((/** @type {any[]} */ c) => c[3] === EMS_EPCI).map((/** @type {any[]} */ c) => ({ code: String(c[0]), nom: String(c[2]) }))
    .sort((/** @type {{nom: string}} */ a, /** @type {{nom: string}} */ b) => a.nom.localeCompare(b.nom, 'fr'));
  ems = out;
  return out;
}

/** the closed list of codes of a signal, in publication order */
export function codesOf(/** @type {string} */ signal) {
  switch (signal) {
    case 'search_need': return [...socialReference().subdomains.keys()];
    case 'search_category': return [...AID_CATEGORIES];
    case 'situation': return Object.keys(SITUATIONS);
    case 'parcours_added': case 'parcours_closed': return parcoursStepCodes().map((s) => s.code);
    case 'social_referral': return [...SOCIAL_REFERRAL_REASONS];
    default: return [];
  }
}

/* ------------------------------------------------------------------------------------------------------------------------------------------ switches */

/** the signals this environment records (ADA_DEMAND_SIGNALS) @param {Record<string, string | undefined>} [envVars] @returns {Set<string>} */
export function recordedSignals(envVars = process.env) {
  const named = String(envVars.ADA_DEMAND_SIGNALS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return new Set(named.flatMap((f) => (Object.prototype.hasOwnProperty.call(FAMILIES, f) ? FAMILIES[/** @type {keyof typeof FAMILIES} */ (f)] : [])));
}
/** @param {string} signal @param {Record<string, string | undefined>} [envVars] */
export const signalRecorded = (signal, envVars = process.env) => recordedSignals(envVars).has(signal);
/** GET /api/public/observatoire answers only under ADA_OBSERVATOIRE=open (exact) @param {Record<string, string | undefined>} [envVars] */
export function observatoireOpen(envVars = process.env) {
  return String(envVars.ADA_OBSERVATOIRE ?? '').trim().toLowerCase() === 'open';
}

/* ---------------------------------------------------------------------------------------------------------------------------------------- validation */

/**
 * The only shape that may be counted: a known signal, a code of its closed list, and — for search_need only, never for a sensitive subdomain — an
 * Eurométropole commune code or « HORS ». Anything else gives null (nothing is counted). `commune` is an INSEE code as the search filter sends it.
 * @param {string} signal @param {unknown} code @param {unknown} [commune]
 * @returns {{ signal: string, code: string, commune: string } | null}
 */
export function normaliseSignal(signal, code, commune = '') {
  if (!SIGNALS.includes(signal)) return null;
  const c = String(code ?? '').trim();
  if (!c || !codesOf(signal).includes(c)) return null;
  let place = '';
  if (signal === 'search_need' && commune !== null && commune !== undefined && String(commune).trim() !== '') {
    const sub = socialReference().subdomains.get(c);
    if (!sub?.sensitive) {
      const k = String(commune).trim().toUpperCase();
      place = emsCommunes().some((x) => x.code === k) ? k : OUTSIDE;
    }
  }
  return { signal, code: c, commune: place };
}

/** the UTC day of an instant, YYYY-MM-DD @param {Date} [now] */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);
/** the calendar quarter of a UTC day @param {string} day YYYY-MM-DD */
export const quarterOfDay = (day) => `${day.slice(0, 4)}-T${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
/** [start, end) of a quarter label, as YYYY-MM-DD @param {string} label */
export function quarterBounds(label) {
  const y = Number(label.slice(0, 4)); const q = Number(label.slice(6));
  const start = new Date(Date.UTC(y, (q - 1) * 3, 1)); const end = new Date(Date.UTC(y, q * 3, 1));
  return { start: utcDay(start), end: utcDay(end) };
}

/* ------------------------------------------------------------------------------------------------------------------------------------------- publication */

/** primary suppression: below K_MIN (zero included) → null */
export const primary = (/** @type {number} */ n) => (Number(n) >= K_MIN ? Number(n) : null);
/** secondary suppression of one column: a single masked cell → the smallest published one is masked too */
export function complement(/** @type {Array<number | null>} */ values) {
  const out = [...values];
  if (out.filter((v) => v === null).length !== 1) return out;
  let at = -1; out.forEach((v, i) => { if (v !== null && (at < 0 || v < /** @type {number} */ (out[at]))) at = i; });
  if (at >= 0) out[at] = null;
  return out;
}
/** a published column: primary then complementary suppression */
export const publishColumn = (/** @type {number[]} */ raw) => complement(raw.map(primary));
/** the sum of the published cells (the only « total » ever published) and how many cells are masked */
export function columnTotal(/** @type {Array<number | null>} */ values) {
  return { publishedSum: values.reduce((/** @type {number} */ t, v) => t + (v ?? 0), 0), maskedCells: values.filter((v) => v === null).length };
}

/**
 * The published searches of one quarter. `rows`: raw counts { signal: 'search_need', code, commune, n }. `protect(a, c)`: the C8 marginal protection
 * (injected so this module stays pure; api/_services/territorial-stats.js protectMarginals after alignColumns).
 * @param {Array<{ code: string, commune: string, n: number }>} rows
 * @param {(a: Array<number | null>, c: Array<number | null>) => [Array<number | null>, Array<number | null>]} protect
 */
export function publishSearches(rows, protect) {
  const ref = socialReference(); const communes = emsCommunes();
  const bySub = new Map(); const byDomainCommune = new Map();
  for (const r of rows) {
    const sub = ref.subdomains.get(r.code); if (!sub) continue;
    bySub.set(r.code, (bySub.get(r.code) || 0) + Number(r.n));
    const key = `${sub.domain}|${r.commune || ''}`; byDomainCommune.set(key, (byDomainCommune.get(key) || 0) + Number(r.n));
  }
  const domains = ref.domains.map((domain) => {
    const subs = [...ref.subdomains.values()].filter((s) => s.domain === domain);
    const rawSubs = subs.map((s) => bySub.get(s.id) || 0);
    const rawTotal = rawSubs.reduce((a, b) => a + b, 0);
    let subCells = publishColumn(rawSubs);
    /** @type {null | { communes: Array<{ commune: string, value: number | null }>, noCommune: number | null, outside: number | null }} */
    let byCommune = null;
    if (rawTotal >= COMMUNE_TABLE_MIN) {
      const rawC = [...communes.map((c) => byDomainCommune.get(`${domain}|${c.code}`) || 0), byDomainCommune.get(`${domain}|`) || 0, byDomainCommune.get(`${domain}|${OUTSIDE}`) || 0];
      let cCells = publishColumn(rawC);
      [subCells, cCells] = protect(subCells, cCells);
      byCommune = { communes: communes.map((c, i) => ({ commune: c.code, value: cCells[i] })), noCommune: cCells[communes.length], outside: cCells[communes.length + 1] };
    }
    return { domain, ...columnTotal(subCells), subdomains: subs.map((s, i) => ({ code: s.id, value: subCells[i] })), byCommune };
  });
  return { domains };
}

/** the published counts of a code-only signal (situations, categories, Mon Parcours, referral reasons) @param {string} signal @param {Array<{ code: string, n: number }>} rows */
export function publishCodes(signal, rows) {
  const codes = codesOf(signal);
  const by = new Map(); for (const r of rows) by.set(r.code, (by.get(r.code) || 0) + Number(r.n));
  const cells = publishColumn(codes.map((c) => by.get(c) || 0));
  return { ...columnTotal(cells), codes: codes.map((code, i) => ({ code, value: cells[i] })) };
}

/** a supply count of the PUBLIC directory: exact from K_MIN, « 1 à 4 » as null, 0 exact (an absence is the signal) @param {number} n */
export const supplyCell = (n) => (n === 0 ? 0 : n >= K_MIN ? n : null);

/**
 * The gaps of one quarter: for each domain, the published searches against the public places of the Eurométropole at freezing time. Not a need, not a
 * non-take-up rate: « many searches, few published places » — a lead to check, with the caveats the page and the CSV carry.
 *   NO_PLACE       published searches (≥ K_MIN) and no published place of that domain in the Eurométropole;
 *   FEW_PLACES     published searches and 1 to 4 places;
 *   RATIO          published searches and K_MIN places or more: `perPlace` = searches / places, one decimal;
 *   NOT_MEASURED   searches below K_MIN (masked) — nothing is said.
 * Per commune (only where the domain has a commune table): NO_PLACE_IN_COMMUNE when a published commune cell meets no published place of that domain.
 * @param {ReturnType<typeof publishSearches>} searches
 * @param {{ byDomain: Array<{ domain: string, places: number | null }>, byCommune: Array<{ commune: string, byDomain: Record<string, number | null> }> }} supply
 */
export function computeGaps(searches, supply) {
  const placesOf = new Map(supply.byDomain.map((d) => [d.domain, d.places]));
  const domainGaps = searches.domains.map((d) => {
    const demand = d.publishedSum; const places = placesOf.get(d.domain);
    const kind = demand < K_MIN ? 'NOT_MEASURED' : places === 0 ? 'NO_PLACE' : places === null || places === undefined ? 'FEW_PLACES' : 'RATIO';
    return { domain: d.domain, searches: demand >= K_MIN ? demand : null, places: places ?? null, kind, perPlace: kind === 'RATIO' ? Math.round((10 * demand) / /** @type {number} */ (places)) / 10 : null };
  });
  const communeGaps = [];
  for (const d of searches.domains) {
    if (!d.byCommune) continue;
    for (const c of d.byCommune.communes) {
      if (c.value === null) continue;
      const row = supply.byCommune.find((x) => x.commune === c.commune);
      if (row && row.byDomain[d.domain] === 0) communeGaps.push({ domain: d.domain, commune: c.commune, searches: c.value, kind: 'NO_PLACE_IN_COMMUNE' });
    }
  }
  return { byDomain: domainGaps, byCommune: communeGaps };
}

/* --------------------------------------------------------------------------------------------------------------------------------------- the CSV */

const CSV_HEAD = ['jeu', 'trimestre', 'date_gel', 'signal', 'domaine', 'code', 'commune_insee', 'commune', 'valeur', 'statut'];
const cell = (/** @type {unknown} */ v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** statut of a published value: exact, « masque » (below K_MIN, or hidden to protect another cell), « 1_a_4 » (supply band) */
const status = (/** @type {number | null} */ v, band = false) => (v === null ? (band ? '1_a_4' : 'masque') : 'exact');

/**
 * The open-data CSV (Licence Ouverte 2.0): one tidy line per published cell, UTF-8, comma separated, CRLF line ends (RFC 4180). Masked cells have an
 * empty `valeur` and the `statut` « masque »; nothing else is written. @param {any} body the public observatoire answer
 */
export function observatoireCsv(body) {
  const names = new Map(body.territory.communes.map((/** @type {any} */ c) => [c.code, c.label]));
  /** @type {string[][]} */ const lines = [CSV_HEAD];
  const line = (/** @type {unknown[]} */ xs) => lines.push(xs.map(cell));
  for (const q of body.quarters) {
    const base = ['demande', q.quarter, q.frozenAt.slice(0, 10)];
    for (const d of q.search?.domains || []) {
      for (const s of d.subdomains) line([...base, 'search_need', d.domain, s.code, '', '', s.value, status(s.value)]);
      if (d.byCommune) {
        for (const c of d.byCommune.communes) line([...base, 'search_need_commune', d.domain, '', c.commune, names.get(c.commune) || '', c.value, status(c.value)]);
        line([...base, 'search_need_commune', d.domain, '', '', 'sans_commune', d.byCommune.noCommune, status(d.byCommune.noCommune)]);
        line([...base, 'search_need_commune', d.domain, '', '', 'hors_eurometropole', d.byCommune.outside, status(d.byCommune.outside)]);
      }
    }
    for (const [signal, key] of /** @type {Array<[string, string]>} */ ([['search_category', 'categories'], ['situation', 'situations'], ['parcours_added', 'parcoursAdded'], ['parcours_closed', 'parcoursClosed'], ['social_referral', 'referrals']])) {
      for (const c of q[key]?.codes || []) line([...base, signal, '', c.code, '', '', c.value, status(c.value)]);
    }
    for (const b of q.bookings?.byDomain || []) {
      line(['reservation', q.quarter, q.frozenAt.slice(0, 10), 'booking_requested', b.domain, '', '', '', b.requested, status(b.requested)]);
      line(['reservation', q.quarter, q.frozenAt.slice(0, 10), 'bookable_places', b.domain, '', '', '', b.bookablePlaces, status(b.bookablePlaces, true)]);
    }
    for (const g of q.gaps?.byDomain || []) line(['ecart', q.quarter, q.frozenAt.slice(0, 10), g.kind, g.domain, '', '', '', g.perPlace ?? '', g.kind === 'NOT_MEASURED' ? 'masque' : 'indicatif']);
    for (const g of q.gaps?.byCommune || []) line(['ecart', q.quarter, q.frozenAt.slice(0, 10), g.kind, g.domain, '', g.commune, names.get(g.commune) || '', g.searches, 'indicatif']);
  }
  const sup = body.supply;
  for (const d of sup.byDomain) {
    line(['offre', '', sup.computedAt.slice(0, 10), 'places', d.domain, '', '', '', d.places, status(d.places, true)]);
    line(['offre', '', sup.computedAt.slice(0, 10), 'bookable_places', d.domain, '', '', '', d.bookable, status(d.bookable, true)]);
    line(['offre', '', sup.computedAt.slice(0, 10), 'opening_hours_indicated', d.domain, '', '', '', d.hours, status(d.hours, true)]);
  }
  for (const c of sup.byCommune) line(['offre', '', sup.computedAt.slice(0, 10), 'places_commune_total', '', '', c.commune, names.get(c.commune) || '', c.places, status(c.places, true)]);
  for (const c of sup.byCommune) for (const [domain, v] of Object.entries(c.byDomain)) line(['offre', '', sup.computedAt.slice(0, 10), 'places_commune', domain, '', c.commune, names.get(c.commune) || '', v, status(/** @type {number | null} */ (v), true)]);
  return `${lines.map((l) => l.join(',')).join('\r\n')}\r\n`;
}

/** French master text of the method and its limits (the page and the documentation translate it; the CSV readme repeats it) */
export const METHOD_TEXT = Object.freeze({
  nature: 'Ce sont des signaux d’usage du site AccesDirectAide, pas une mesure du non-recours officiel. Ce ne sont pas des statistiques officielles.',
  count: 'Chaque signal compte un événement (une recherche, un choix de situation, une étape ajoutée), pas une personne : une même personne peut en produire plusieurs, et la plupart des personnes ne passent pas par le site.',
  privacy: 'Aucun texte saisi, aucun identifiant, aucune adresse IP, aucune heure ne sont enregistrés : seulement un code de liste fermée, un jour et, pour les recherches, une commune de l’Eurométropole (jamais pour un sujet sensible). Les comptes du jour sont supprimés dès que le trimestre est figé.',
  suppression: `Une valeur inférieure à ${K_MIN} (zéro compris) est « masquée » ; quand une seule valeur est masquée dans un tableau, une autre l’est aussi, pour qu’on ne puisse pas la retrouver par soustraction ; une commune n’est détaillée que pour un domaine d’au moins ${COMMUNE_TABLE_MIN} recherches dans le trimestre ; les totaux sont des sommes de valeurs publiées.`,
  supply: 'L’offre compte les lieux d’accueil publiés dans l’annuaire du site (vérifiés sur une source officielle), classés par domaine d’après leur type et les services qu’ils déclarent. Un lieu non publié n’est pas compté ; un lieu peut servir plusieurs communes et plusieurs domaines.',
  gaps: 'Un « écart » rapproche les recherches d’un domaine et les lieux publiés de ce domaine. C’est une piste à vérifier sur le terrain, pas un besoin non couvert : l’annuaire est incomplet et une recherche n’est pas un besoin.',
  freeze: 'Seuls les trimestres civils terminés sont publiés, une seule fois, à leur date de gel ; ils ne changent plus ensuite.',
});
