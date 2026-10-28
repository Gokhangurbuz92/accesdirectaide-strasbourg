// @ts-nocheck
/**
 * Automatic verification chain — the checks of an organization record against the official registries (pure functions: no I/O here).
 *
 *  - identity: the SIRENE establishment is open (a closed establishment is withdrawn from the directory with the registry's closing date as reason);
 *  - place: the record's postal code / address agree with SIRENE and, for public offices, with the Annuaire de l'administration;
 *  - territory: the official commune code is in the Bas-Rhin (67…);
 *  - corrections: a field is corrected automatically only when the official sources AGREE on the new value (two sources, or one registry and no
 *    contradiction); otherwise the difference is recorded and the record keeps its value.
 */
import { digits } from './registries.js';

const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(bat|batiment|bp|cs|cedex)\b\s*\w*/g, ' ')
  .split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['rue', 'route', 'avenue', 'av', 'place', 'pl', 'bd', 'boulevard', 'quai', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd'].includes(w));
/** Street number + street name tokens, without the postal code / city (compared separately). */
const streetTokens = (address, postalCode, city) => words(String(address || '').replace(digits(postalCode) ? new RegExp(`\\b${digits(postalCode)}\\b`) : /$^/, ' ').replace(city ? new RegExp(String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/, ' '));
/** Share of the record's street tokens found in the official address (1 = same street and number). */
export function addressAgreement(recordAddress, officialAddress, postalCode, city) {
  const a = streetTokens(recordAddress, postalCode, city); const b = new Set(streetTokens(officialAddress, postalCode, city));
  if (!a.length || !b.size) return null;
  return a.filter((w) => b.has(w)).length / a.length;
}

/** street number and street words of an address (postal code, city and complements such as « siège social », « bâtiment B » left out) */
function streetParts(address, postalCode, city) {
  const cleaned = String(address || '').replace(digits(postalCode) ? new RegExp(`\\b${digits(postalCode)}\\b`) : /$^/, ' ')
    .replace(city ? new RegExp(String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/, ' ');
  const num = (cleaned.match(/(?:^|[\s,])(\d{1,4})(?:\s?(?:bis|ter|b|t))?(?=[\s,]|$)/i) || [])[1] || null;
  const tokens = [...new Set(words(cleaned).filter((w) => !/^\d+$/.test(w) && !['bis', 'ter', 'siege', 'social', 'etage', 'porte', 'entree', 'escalier', 'residence'].includes(w)))];
  return { num, tokens };
}
/** `own` names the same street AND number as `official` (the number is required when the official address has one): the record's own wording may be kept */
export function sameStreetNumber(own, official, postalCode, city) {
  const x = streetParts(own, postalCode, city); const y = streetParts(official, postalCode, city);
  if (y.num && x.num !== y.num) return false;
  return sameStreet(own, official, postalCode, city) === true;
}

/** the street part of an address written with its postal code and commune (« 11 Route de la Fédération 67000 Strasbourg » → « 11 Route de la Fédération »): they have fields of their own */
export const streetOnly = (address) => String(address || '').replace(/[\s,]*\b\d{5}\b.*$/, '').trim() || null;

const LOWER = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'sur', 'sous', 'au', 'aux', 'rue', 'route', 'avenue', 'boulevard', 'quai', 'place', 'allee', 'allée', 'impasse',
  'chemin', 'cours', 'square', 'passage', 'faubourg', 'chaussee', 'chaussée', 'esplanade', 'parvis', 'promenade', 'sentier', 'voie', 'rond-point']);
const capital = (w) => w.replace(/(^|[-'’])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
/**
 * An address a registry writes in capitals without accents (« 33 RUE KAGENECK ») in the case people read (« 33 rue Kageneck »): easy-to-read texts never write
 * whole words in capitals. A text with a lowercase letter is left as it is; numbers (« 11B ») and single letters (« BAT B ») keep their form; the accents the
 * registry dropped cannot be restored.
 */
export function readableCase(text) {
  const s = String(text || '');
  if (!s || /\p{Ll}/u.test(s)) return s;
  return s.split(/(\s+)/).map((w, i) => {
    if (!w || /^\s+$/.test(w) || /^\d/.test(w) || /^\p{L}$/u.test(w)) return w;
    const low = w.toLowerCase(); const el = low.match(/^([dl]['’])(.+)$/u);
    if (el) return (i > 0 ? el[1] : el[1].toUpperCase()) + capital(el[2]);
    return i > 0 && LOWER.has(low) ? low : capital(low);
  }).join('');
}

/**
 * Same street, for an IDENTITY (matching a record to an office or an establishment): the street numbers agree when both are given, and the street words of the
 * shorter address are (nearly) all in the other. « 8 rue Adolphe Seyboth » is not « 2 rue Gustave Adolphe Hirn »; « 13 rue Martin Bucer » is « 13 rue
 * Martin-Bucer, siège social ». null when an address is missing (nothing to compare).
 */
export function sameStreet(a, b, postalCode, city) {
  const x = streetParts(a, postalCode, city); const y = streetParts(b, postalCode, city);
  if (!x.tokens.length || !y.tokens.length) return null;
  if (x.num && y.num && x.num !== y.num) return false;
  const shared = x.tokens.filter((w) => y.tokens.includes(w)).length;
  return shared / Math.min(x.tokens.length, y.tokens.length) >= 0.66;
}

/**
 * @param {{ nom?: string, adresse?: string, code_postal?: string, ville?: string, telephone?: string, siret?: string }} record
 * @param {{ sirene?: any, offices?: any[] }} found  sirene = lookupSiret(...) result (or null when the record has no SIRET / the registry could not be read)
 */
export function checkStructure(record, found = {}) {
  const reasons = []; const evidence = []; const corrections = {}; const differences = [];
  const s = found.sirene && found.sirene.found ? found.sirene : null;
  let identity = 'UNKNOWN';
  if (found.sirene && found.sirene.found === false) { identity = 'NOT_IN_REGISTRY'; reasons.push(`Le numéro SIRET ${found.sirene.siret || ''} est inconnu du registre SIRENE.`); }
  if (s) {
    evidence.push(s.evidenceUrl);
    if (!s.open) { identity = 'CLOSED'; reasons.push(`Établissement fermé selon le registre SIRENE${s.closedAt ? ` (fermeture le ${s.closedAt})` : ''}.`); }
    else identity = 'OPEN';
  }
  // the public office matching the record best (same postal code first)
  const offices = Array.isArray(found.offices) ? found.offices : [];
  const office = offices.find((o) => o.postalCode && o.postalCode === digits(record.code_postal)) || null;
  if (office?.evidenceUrl) evidence.push(office.evidenceUrl);
  if (identity === 'UNKNOWN' && office) identity = 'PUBLIC_OFFICE';

  // place: postal code and street, agreed between the official sources
  const officialPlaces = [s && { src: 'SIRENE', postalCode: s.postalCode, address: s.address, city: s.city, insee: s.communeInsee },
    office && { src: 'ANNUAIRE', postalCode: office.postalCode, address: office.address, city: office.city, insee: office.communeInsee }].filter(Boolean);
  const cps = [...new Set(officialPlaces.map((p) => p.postalCode).filter(Boolean))];
  const recordCp = digits(record.code_postal).slice(0, 5);
  if (cps.length === 1 && recordCp && cps[0] !== recordCp) {
    differences.push({ field: 'code_postal', record: recordCp, official: cps[0], sources: officialPlaces.map((p) => p.src) });
    corrections.code_postal = cps[0];
  } else if (cps.length > 1 && !cps.includes(recordCp)) {
    differences.push({ field: 'code_postal', record: recordCp, official: cps, sources: officialPlaces.map((p) => p.src), conflict: true });
  }
  const agreements = officialPlaces.map((p) => ({ src: p.src, score: addressAgreement(record.adresse, p.address, p.postalCode, p.city) })).filter((x) => x.score !== null);
  if (agreements.length && agreements.every((a) => a.score < 0.5)) differences.push({ field: 'adresse', record: record.adresse || null, official: officialPlaces.map((p) => `${p.src} : ${p.address}`), conflict: officialPlaces.length > 1 });
  // a missing SIRET found by name in the same postal code (a single open candidate) is added
  if (!digits(record.siret) && found.candidate && found.candidate.open) corrections.siret = found.candidate.siret;

  const insee = officialPlaces.map((p) => p.insee).find(Boolean) || null;
  const territory = insee ? insee.startsWith('67') : (recordCp ? recordCp.startsWith('67') : null);
  if (territory === false) reasons.push(`Hors du territoire (commune ${insee || recordCp}).`);

  const confirmedBy = officialPlaces.length + (s && s.open ? 0 : 0);
  return { identity, territory, office, sirene: s, differences, corrections, evidence: [...new Set(evidence)], reasons, confirmedBy };
}
