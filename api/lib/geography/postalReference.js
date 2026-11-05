/**
 * R46 / P07 — postal code → commune(s) and QPV, read from the committed OFFICIAL references only (no network at run time, nothing persisted):
 *   data/reference/postal-codes.v1.json  La Poste « Base officielle des codes postaux » (Licence Ouverte v2.0), matched to the INSEE COG 2026 codes;
 *   data/reference/qpv-2024.v1.json      ANCT list of the 2024 quartiers prioritaires (Licence Ouverte v1.0), WITHOUT perimeters;
 *   data/geography/insee-2026.v1.json    commune names and départements; data/geography/service-territory.v1.json the Eurométropole communes.
 * Rules:
 *  - a postal code with several communes is MULTIPLE: the candidates are returned in a stable order and the person chooses — never the first one;
 *  - a code absent from the La Poste file is UNKNOWN_POSTAL_CODE; anything that is not five digits is INVALID; a missing reference file is UNAVAILABLE;
 *  - QPV: the product says which communes COUNT a quartier prioritaire, never whether an address lies in one (that needs the official address lookup of
 *    sig.ville.gouv.fr); the answer always carries that sentence's facts (`qpvScope: 'COMMUNE_ONLY'`) and the official lookup address;
 *  - this module neither logs nor stores the postal code (the router's own request log records GET query strings, api/index.js — pinned).
 */
import fs from 'node:fs';
import path from 'node:path';

const FILES = {
  postal: 'data/reference/postal-codes.v1.json',
  qpv: 'data/reference/qpv-2024.v1.json',
  insee: 'data/geography/insee-2026.v1.json',
  service: 'data/geography/service-territory.v1.json',
};

/** @typedef {{ postal: any, qpvByCommune: Map<string, { code: string, libelle: string }[]>, qpvSource: any, names: Map<string, { nom: string, departement: string | null }>, service: Set<string>, serviceLabel: string }} Loaded */
/** @type {Loaded | null} */
let cache = null;

/** @param {string} [root] */
function load(root = process.cwd()) {
  if (cache) return cache;
  const read = (/** @type {string} */ f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const postal = read(FILES.postal);
  const qpv = read(FILES.qpv);
  const insee = read(FILES.insee);
  const service = read(FILES.service);
  /** @type {Map<string, { nom: string, departement: string | null }>} */
  const names = new Map();
  for (const [code, dep, nom] of insee.communes) names.set(code, { nom, departement: dep });
  const communeDep = new Map(insee.communes.map((/** @type {string[]} */ c) => [c[0], c[1]]));
  for (const [code, commune, nom] of insee.arrondissementsMunicipaux) names.set(code, { nom, departement: communeDep.get(commune) || null });
  /** @type {Map<string, { code: string, libelle: string }[]>} */
  const qpvByCommune = new Map();
  for (const [code, libelle, , communes] of qpv.qpv) {
    for (const c of communes) qpvByCommune.set(c, [...(qpvByCommune.get(c) || []), { code, libelle }]);
  }
  cache = {
    postal, qpvByCommune, qpvSource: { ...qpv.source, freshness: qpv.freshness }, names,
    service: new Set(service.communes.map((/** @type {string[]} */ c) => c[0])), serviceLabel: service.libelle,
  };
  return cache;
}

/** test seam: forget the loaded files */
export function resetPostalReferenceCache() { cache = null; }

const sourceOf = (/** @type {any} */ s, /** @type {any} */ freshness) => ({
  producer: s.producer, title: s.title, page: s.page, licence: s.licence, publishedAt: s.publishedAt, readAt: freshness?.readAt || s.retrievedAt, reviewBefore: freshness?.reviewBefore || null,
});

export const QPV_OFFICIAL_LOOKUP = 'https://sig.ville.gouv.fr';

/**
 * The QPV that list a commune (official 2024 list). @param {string} communeCode
 * @returns {{ status: 'OK' | 'INVALID' | 'UNAVAILABLE', communeCode?: string, quartiers?: { code: string, libelle: string }[], qpvScope?: 'COMMUNE_ONLY', officialLookup?: string, source?: object }}
 */
export function qpvForCommune(communeCode, { root } = /** @type {{ root?: string }} */ ({})) {
  const code = String(communeCode || '').trim().toUpperCase();
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(code)) return { status: 'INVALID' };
  let ref;
  try { ref = load(root); } catch { return { status: 'UNAVAILABLE' }; }
  return {
    status: 'OK', communeCode: code, quartiers: (ref.qpvByCommune.get(code) || []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    qpvScope: 'COMMUNE_ONLY', officialLookup: QPV_OFFICIAL_LOOKUP, source: sourceOf(ref.qpvSource, ref.qpvSource.freshness),
  };
}

/**
 * @param {string} rawCode the five digits typed by the person
 * @returns {{ status: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN_POSTAL_CODE' | 'INVALID' | 'UNAVAILABLE', postalCode?: string,
 *   candidates?: { code: string, nom: string, departement: string | null, inServiceTerritory: boolean, quartiersPrioritaires: { code: string, libelle: string }[] }[],
 *   serviceTerritory?: { label: string, anyCandidateInside: boolean }, qpvScope?: 'COMMUNE_ONLY', officialQpvLookup?: string, source?: object, qpvSource?: object }}
 */
export function resolvePostalCode(rawCode, { root } = /** @type {{ root?: string }} */ ({})) {
  const cp = String(rawCode ?? '').replace(/\s+/g, '');
  if (!/^\d{5}$/.test(cp)) return { status: 'INVALID' };
  let ref;
  try { ref = load(root); } catch { return { status: 'UNAVAILABLE' }; }
  const codes = ref.postal.postalCodes[cp];
  const source = sourceOf(ref.postal.source, ref.postal.freshness);
  if (!Array.isArray(codes) || codes.length === 0) return { status: 'UNKNOWN_POSTAL_CODE', postalCode: cp, source };
  const candidates = codes
    .map((/** @type {string} */ code) => {
      const n = ref.names.get(code);
      return {
        code, nom: n?.nom || code, departement: n?.departement || null, inServiceTerritory: ref.service.has(code),
        quartiersPrioritaires: (ref.qpvByCommune.get(code) || []).slice().sort((a, b) => a.code.localeCompare(b.code)),
      };
    })
    // a stable, meaningful order (alphabetical, French collation), never « the first one is the answer »
    .sort((/** @type {{ nom: string, code: string }} */ a, /** @type {{ nom: string, code: string }} */ b) => a.nom.localeCompare(b.nom, 'fr') || a.code.localeCompare(b.code));
  return {
    status: candidates.length === 1 ? 'SINGLE' : 'MULTIPLE',
    postalCode: cp,
    candidates,
    serviceTerritory: { label: ref.serviceLabel, anyCandidateInside: candidates.some((/** @type {{ inServiceTerritory: boolean }} */ c) => c.inServiceTerritory) },
    qpvScope: 'COMMUNE_ONLY',
    officialQpvLookup: QPV_OFFICIAL_LOOKUP,
    source,
    qpvSource: sourceOf(ref.qpvSource, ref.qpvSource.freshness),
  };
}

/** freshness of both references (status page / readiness) @param {Date} [now] */
export function postalReferenceFreshness(now = new Date(), { root } = /** @type {{ root?: string }} */ ({})) {
  let ref;
  try { ref = load(root); } catch { return { status: 'UNAVAILABLE' }; }
  const due = (/** @type {string | null | undefined} */ d) => Boolean(d && Date.parse(`${d}T00:00:00Z`) < now.getTime());
  return {
    status: due(ref.postal.freshness?.reviewBefore) || due(ref.qpvSource.freshness?.reviewBefore) ? 'REVIEW_DUE' : 'FRESH',
    postal: { readAt: ref.postal.freshness?.readAt, reviewBefore: ref.postal.freshness?.reviewBefore, postalCodes: ref.postal.counts?.postalCodes },
    qpv: { readAt: ref.qpvSource.freshness?.readAt, reviewBefore: ref.qpvSource.freshness?.reviewBefore },
  };
}

export default { resolvePostalCode, qpvForCommune, postalReferenceFreshness, resetPostalReferenceCache };
