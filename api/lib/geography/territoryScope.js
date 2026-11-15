/**
 * Owner decision G1 = b — the AUTHORISED TERRITORY of an institutional account, as a set of INSEE communes. The account stores the official label written by
 * api/lib/geography/officialTerritory.js (a région, a département, an EPCI or a commune of data/geography/insee-2026.v1.json); this module turns that label
 * back into the communes it covers. Fail closed: a label that is missing, unknown, free text from before R20, or that names two different territories gives
 * NO scope (`ok: false`) — never « every commune ». Nothing here reads a request: the scope comes from the account row only.
 *
 * It also places an organization in a commune from its declared address (`ville` + `code_postal`, there is no INSEE column for the location: `insee_codes` is
 * the service area). The name and the postal code must agree on exactly one commune (without a postal code: a name only ONE commune of France bears);
 * anything else is « not located » and is counted in no scoped statistic.
 *
 * Publication blocks: the scoped observatoire publishes one table per BLOCK (the EPCI of the commune; a commune without EPCI is its own block). Blocks never
 * overlap, so two institutional views can never be subtracted into a territory that is not itself published (api/_services/territorial-stats.js).
 */
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ code: string, dep: string, nom: string, epci: string }} Commune */
/** @typedef {{ communes: Map<string, Commune>, byName: Map<string, string[]>, depRegion: Map<string, string>, depNames: Map<string, string[]>, regionNames: Map<string, string[]>, epciNames: Map<string, string[]>, epciCodes: Set<string>, parentOf: Map<string, string>, postal: Record<string, string[]> }} Ref */
/** @type {Map<string, Ref>} */
const cache = new Map();

/** @param {unknown} s */
export const foldName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** @param {Map<string, string[]>} m @param {string} k @param {string} v */
const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

/** @param {string} root @returns {Ref} */
function load(root) {
  const hit = cache.get(root); if (hit) return hit;
  const read = (/** @type {string} */ f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const insee = read('data/geography/insee-2026.v1.json');
  /** @type {Ref} */
  const ref = { communes: new Map(), byName: new Map(), depRegion: new Map(), depNames: new Map(), regionNames: new Map(), epciNames: new Map(), epciCodes: new Set(), parentOf: new Map(), postal: {} };
  for (const [code, nom] of insee.regions) push(ref.regionNames, foldName(nom), code);
  for (const [code, region, nom] of insee.departements) { ref.depRegion.set(code, region); push(ref.depNames, foldName(nom), code); }
  for (const [code, nom] of insee.epcis) { ref.epciCodes.add(code); push(ref.epciNames, foldName(nom), code); }
  for (const [code, dep, nom, epci] of insee.communes) { ref.communes.set(code, { code, dep, nom, epci: /^\d{9}$/.test(String(epci || '')) ? epci : '' }); push(ref.byName, foldName(nom), code); }
  // an arrondissement municipal (Paris, Lyon, Marseille) is its commune
  for (const [code, commune, nom] of insee.arrondissementsMunicipaux) { ref.parentOf.set(code, commune); push(ref.byName, foldName(nom), commune); }
  try { ref.postal = read('data/reference/postal-codes.v1.json').postalCodes || {}; } catch { ref.postal = {}; }   // without the La Poste file: the name and the département must agree
  cache.set(root, ref);
  return ref;
}

/** test seam: forget the loaded files */
export function resetTerritoryScopeCache() { cache.clear(); }

/** The publication block of a commune: its EPCI, or itself when it belongs to none. @param {Commune} c */
const blockOf = (c) => (c.epci ? `epci:${c.epci}` : `commune:${c.code}`);

/**
 * The communes an official territory label covers.
 * @param {unknown} label the value of "InstitutionAccount".territory
 * @param {{ root?: string }} [opts]
 * @returns {{ ok: true, kind: 'region' | 'departement' | 'epci' | 'commune', code: string, communes: Set<string> } | { ok: false, reason: 'MISSING' | 'UNKNOWN' | 'AMBIGUOUS' | 'UNAVAILABLE' }}
 */
export function territoryScope(label, { root = process.cwd() } = {}) {
  if (label !== null && label !== undefined && typeof label !== 'string') return { ok: false, reason: 'UNKNOWN' };   // the column is text: anything else is not a territory
  const raw = String(label ?? '').trim();
  if (!raw) return { ok: false, reason: 'MISSING' };
  /** @type {Ref} */
  let ref;
  try { ref = load(root); } catch { return { ok: false, reason: 'UNAVAILABLE' }; }
  /** @type {{ kind: 'region' | 'departement' | 'epci' | 'commune', code: string }[]} */
  const hits = [];
  // « Nom (code) »: the label of a commune (67482) and of an EPCI whose name is not unique (SIREN); the name must be the one of that code
  const coded = raw.match(/^(.+) \((\d{9}|\d{5}|2[AB]\d{3})\)$/);
  if (coded) {
    const name = foldName(coded[1]); const code = coded[2];
    if (code.length === 9) { if ((ref.epciNames.get(name) || []).includes(code)) hits.push({ kind: 'epci', code }); }
    else if (foldName(ref.communes.get(code)?.nom) === name && name) hits.push({ kind: 'commune', code });
  } else if (/^(\d{9}|\d{5}|2[AB]\d{3}|\d{2,3}|2[AB])$/.test(raw.toUpperCase())) {
    // a bare official code, read like officialTerritory does: SIREN = EPCI, five characters = commune, two or three = département (never a région)
    const code = raw.toUpperCase();
    if (code.length === 9) { if (ref.epciCodes.has(code)) hits.push({ kind: 'epci', code }); }
    else if (code.length === 5) { if (ref.communes.has(code)) hits.push({ kind: 'commune', code }); }
    else if (ref.depRegion.has(code)) hits.push({ kind: 'departement', code });
  } else {
    const name = foldName(raw);
    for (const code of ref.regionNames.get(name) || []) hits.push({ kind: 'region', code });
    for (const code of ref.depNames.get(name) || []) hits.push({ kind: 'departement', code });
    for (const code of ref.epciNames.get(name) || []) hits.push({ kind: 'epci', code });
  }
  if (!hits.length) return { ok: false, reason: 'UNKNOWN' };
  const sets = hits.map((h) => {
    const set = new Set();
    for (const c of ref.communes.values()) {
      if (h.kind === 'commune' ? c.code === h.code : h.kind === 'epci' ? c.epci === h.code : h.kind === 'departement' ? c.dep === h.code : ref.depRegion.get(c.dep) === h.code) set.add(c.code);
    }
    return set;
  });
  // one name for two official territories (a région that is also a département: Guadeloupe, La Réunion…) is accepted only when both cover the SAME communes
  const first = sets[0];
  if (!first.size) return { ok: false, reason: 'UNKNOWN' };
  for (const s of sets.slice(1)) { if (s.size !== first.size) return { ok: false, reason: 'AMBIGUOUS' }; for (const c of s) if (!first.has(c)) return { ok: false, reason: 'AMBIGUOUS' }; }
  return { ok: true, kind: hits[0].kind, code: hits[0].code, communes: first };
}

/** The label to store for an official territory so that territoryScope reads it back: the official label, with the SIREN when two EPCI share the name. */
export function scopeLabel(/** @type {{ label: string, kind: string, code: string }} */ place, { root = process.cwd() } = {}) {
  if (territoryScope(place.label, { root }).ok) return place.label;
  const withCode = `${place.label} (${place.code})`;
  return place.kind === 'epci' && territoryScope(withCode, { root }).ok ? withCode : null;
}

/** @param {string} cp a five-digit postal code @returns {string[]} the département code(s) its first digits name */
const postalDepartements = (cp) => (cp.startsWith('20') ? ['2A', '2B'] : /^9[78]/.test(cp) ? [cp.slice(0, 3)] : [cp.slice(0, 2)]);

/**
 * The commune an organization is in, from its declared address. Strict: the commune name and the postal code must agree on exactly ONE commune.
 * @param {{ ville?: unknown, code_postal?: unknown }} address
 * @param {{ root?: string }} [opts]
 * @returns {{ code: string, nom: string, block: string } | null} null = not located (never guessed)
 */
export function communeOfAddress(address, { root = process.cwd() } = {}) {
  /** @type {Ref} */
  let ref;
  try { ref = load(root); } catch { return null; }
  const name = foldName(String(address?.ville || '').replace(/\bcedex\b.*$/i, ''));
  const cp = String(address?.code_postal ?? '').replace(/\s+/g, '');
  const named = [...new Set(ref.byName.get(name) || [])];
  if (!name || !named.length) return null;
  if (!cp) { const only = named.length === 1 ? ref.communes.get(named[0]) : null; return only ? { code: only.code, nom: only.nom, block: blockOf(only) } : null; }
  if (!/^\d{5}$/.test(cp)) return null;
  const listed = ref.postal[cp];
  /** @type {string[]} */
  let hits;
  if (Array.isArray(listed) && listed.length) {
    const inPostal = new Set(listed.map((c) => ref.parentOf.get(c) || c));
    hits = named.filter((c) => inPostal.has(c));
  } else {
    // a postal code La Poste does not list as a commune's (CEDEX): the name must be unique in the département the code names
    const deps = postalDepartements(cp);
    hits = named.filter((c) => deps.includes(ref.communes.get(c)?.dep || ''));
  }
  if (hits.length !== 1) return null;
  const c = ref.communes.get(hits[0]);
  return c ? { code: c.code, nom: c.nom, block: blockOf(c) } : null;
}

export default { territoryScope, scopeLabel, communeOfAddress, foldName, resetTerritoryScopeCache };
