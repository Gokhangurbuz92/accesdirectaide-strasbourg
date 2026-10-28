// @ts-nocheck
import { logger } from '../logger.js';
/**
 * FinessConnector — Ingestion du fichier FINESS (Fichier National des Établissements
 * Sanitaires et Sociaux) depuis data.gouv.fr.
 *
 * Source : Export CSV national FINESS (séparateur point-virgule, PAS d'en-tête).
 * Format : Colonnes positionnelles fixes (voir COLUMN_MAP ci-dessous).
 * Ligne 1 = métadonnée ("finess;etalab;106;2026-01-07")
 * Lignes 2+ = données ("structureet;010000024;010780054;CH DE FLEYRIAT;...")
 *
 * Résilience : Retry avec backoff exponentiel, timeout 30s, cap à 5000 items.
 */

const DEFAULT_FINESS_URL =
  'https://www.data.gouv.fr/fr/datasets/r/2ce43ade-8d2c-4d1d-81da-ca06c82abc68';

const TIMEOUT_MS = 30_000;
const MAX_ITEMS = 5_000;
const MAX_RETRIES = 3;

/**
 * Positional column mapping for the FINESS CSV export (0-indexed).
 * Verified from actual data.gouv.fr export (Feb 2026).
 *
 *  0: type_enregistrement ("structureet" | "geolocalisation" | ...)
 *  1: nofinesset          (Numéro FINESS de l'établissement)
 *  2: nofinessej          (Numéro FINESS de l'entité juridique)
 *  3: rs                  (Raison sociale courte)
 *  4: rslongue            (Raison sociale longue)
 *  5-6: (vide/réservé)
 *  7: numvoie             (Numéro de voie, ex "900")
 *  8: typvoie             (Type de voie, ex "RTE")
 *  9: voie                (Libellé de voie, ex "DE PARIS")
 * 10: compvoie            (Complément d'adresse)
 * 11: lieuditbp           (Lieu-dit / BP)
 * 12: commune_code        (Code commune INSEE, ex "451")
 * 13: dept_code           (Code département, ex "01")
 * 14: libdepartement      (Libellé département, ex "AIN")
 * 15: cp_ville            (Code postal + ville, ex "01440 VIRIAT")
 * 16: telephone           (Téléphone, ex "0474454647")
 * 17: telecopie           (Fax)
 * 18: categetab_code      (Code catégorie, ex "355")
 * 19: categetab_lib       (Libellé catégorie, ex "Centre Hospitalier (C.H.)")
 * 20: categagetab_code    (Code catégorie agrégée)
 * 21: categagetab_lib     (Libellé catégorie agrégée)
 * 22: siret
 * 23: code_ape
 * 24: codemft             (Code mode fixation tarif)
 * 25: libmft              (Libellé mode fixation tarif)
 * 26: code_sph
 * 27: lib_sph
 * 28: dateouv             (Date ouverture)
 * 29: dateautor           (Date autorisation)
 * 30: datemaj             (Date mise à jour)
 */
const COL = {
  TYPE: 0,
  NOFINESSET: 1,
  RS: 3,
  RSLONGUE: 4,
  NUMVOIE: 7,
  TYPVOIE: 8,
  VOIE: 9,
  COMPVOIE: 10,
  LIEUDITBP: 11,
  DEPT_CODE: 13,
  DEPT_LIB: 14,
  CP_VILLE: 15,
  TELEPHONE: 16,
  CATEG_CODE: 18,
  CATEG_LIB: 19,
  SIRET: 22,
};

/**
 * @param {string} raw
 * @returns {string}
 */
function clean(raw) {
  return (raw || '').replace(/^"|"$/g, '').trim();
}

/**
 * Parse "01440 VIRIAT" → { cp: "01440", ville: "VIRIAT" }
 * @param {string} raw
 * @returns {{ cp: string, ville: string }}
 */
function parseCpVille(raw) {
  const text = clean(raw);
  const match = text.match(/^(\d{5})\s+(.+)$/);
  if (match) return { cp: match[1], ville: match[2].trim() };
  // Fallback: try to split on first space
  const idx = text.indexOf(' ');
  if (idx > 0) return { cp: text.slice(0, idx), ville: text.slice(idx + 1).trim() };
  return { cp: text, ville: '' };
}

/**
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<string>}
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AccesDirectAideBot/1.0' },
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      logger.warn(`[FINESS] Retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('[FINESS] All retries exhausted');
}

/**
 * Fetch and parse the FINESS dataset, filtered by departments.
 *
 * @param {{
 *   departments?: string[],
 *   limit?: number,
 *   datasetUrl?: string,
 * }} options
 * @returns {Promise<Array<{
 *   numero_finess: string,
 *   nom: string,
 *   type_finess: string,
 *   adresse: string,
 *   code_postal: string,
 *   ville: string,
 *   departement: string,
 *   telephone: string | null,
 *   latitude: number | null,
 *   longitude: number | null,
 *   siret: string | null,
 * }>>}
 */
export async function fetchFinessData(options = {}) {
  const url = options.datasetUrl || process.env.FINESS_DATASET_URL || DEFAULT_FINESS_URL;
  const departments = options.departments || (process.env.FINESS_DEPARTMENTS || '').split(',').filter(Boolean);
  const limit = options.limit || MAX_ITEMS;

  logger.info(`[FINESS] Fetching from ${url} (departments: ${departments.join(',') || 'ALL'})`);

  const text = await fetchWithRetry(url);

  // Strip UTF-8 BOM if present
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = cleaned.split(/\r?\n/).filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`[FINESS] CSV has only ${lines.length} lines — invalid`);
  }

  // Line 0 is metadata ("finess;etalab;106;2026-01-07") — skip it
  const dataLines = lines.slice(1);
  logger.info(`[FINESS] Total data lines: ${dataLines.length}`);

  /** @type {ReturnType<typeof fetchFinessData> extends Promise<infer T> ? T : never} */
  const items = [];

  for (const line of dataLines) {
    if (items.length >= limit) break;

    const cols = line.split(';');

    // Only process "structureet" rows (establishment records)
    const type = clean(cols[COL.TYPE]);
    if (type !== 'structureet') continue;

    const finess = clean(cols[COL.NOFINESSET]);
    if (!finess) continue;

    // Department filter
    const deptCode = clean(cols[COL.DEPT_CODE]);
    if (departments.length > 0 && !departments.includes(deptCode)) continue;

    // Build name (prefer long name, fallback to short)
    const rslongue = clean(cols[COL.RSLONGUE]);
    const rs = clean(cols[COL.RS]);
    const nom = rslongue || rs || 'Établissement FINESS';

    // Build address
    const adresseParts = [
      clean(cols[COL.NUMVOIE]),
      clean(cols[COL.TYPVOIE]),
      clean(cols[COL.VOIE]),
      clean(cols[COL.COMPVOIE]),
      clean(cols[COL.LIEUDITBP]),
    ].filter(Boolean);

    // Parse code postal + ville from combined field
    const { cp, ville } = parseCpVille(cols[COL.CP_VILLE] || '');

    // Category
    const categLib = clean(cols[COL.CATEG_LIB]);

    // Telephone
    const tel = clean(cols[COL.TELEPHONE]);

    // SIRET
    const siret = clean(cols[COL.SIRET]);

    items.push({
      numero_finess: finess,
      nom,
      type_finess: categLib || `code-${clean(cols[COL.CATEG_CODE])}`,
      adresse: adresseParts.join(' ').trim(),
      code_postal: cp,
      ville,
      departement: deptCode,
      telephone: tel || null,
      latitude: null, // FINESS CSV structureet rows don't include coordinates
      longitude: null, // Geoloc data is in separate "geolocalisation" rows
      siret: siret || null,
    });
  }

  logger.info(`[FINESS] Filtered items: ${items.length} (departments: ${departments.join(',') || 'ALL'})`);
  return items;
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';

export function createFinessContractConnector() {
  const legacyShim = {
    name: 'finess',
    baseUrl: 'https://www.data.gouv.fr',
    getDetailUrls: async () => [],
    fetch: async () => '',
    parse: async () => null,
    getStableId: (item) => item.nofinesset || item.id
  };
  return new ConnectorContractAdapter(legacyShim, {
    sourceId: 'finess',
    name: 'FINESS Connector',
    version: '1.0.0',
    entityType: 'Structure',
    capabilities: ['DIRECTORY']
  });
}
