// @ts-nocheck
import { logger } from '../logger.js';
/**
 * RnaConnector — Ingestion de l'API RNA (Répertoire National des Associations).
 *
 * Source : API entreprise.data.gouv.fr/api/rna/v1
 * Stratégie : Recherche full-text par département, pagination complète,
 *             retourne des items prêts pour l'upsert dans le modèle Structure.
 *
 * Résilience : Retry avec backoff exponentiel, timeout 15s par requête, cap à 2000 items.
 */

const DEFAULT_RNA_BASE_URL = 'https://entreprise.data.gouv.fr/api/rna/v1';
const TIMEOUT_MS = 15_000;
const MAX_ITEMS = 2_000;
const MAX_RETRIES = 3;
const PER_PAGE = 100;

/**
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
async function fetchJson(url, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'AccesDirectAideBot/1.0',
                    'Accept': 'application/json',
                },
            });
            clearTimeout(timer);

            if (!response.ok) {
                // 404 on RNA API means no results for this query — not an error
                if (response.status === 404) return { association: [] };
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            if (attempt === retries - 1) throw err;
            const delay = 1000 * Math.pow(2, attempt);
            logger.warn(`[RNA] Retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw new Error('[RNA] All retries exhausted');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safe(value) {
    if (value == null) return '';
    return String(value).trim();
}

/**
 * Fetch associations from the RNA API for the given departments.
 *
 * The RNA API supports full_text search, so we search by department name or code.
 * For each department, we paginate through all results up to MAX_ITEMS total.
 *
 * @param {{
 *   departments?: string[],
 *   limit?: number,
 *   baseUrl?: string,
 * }} options
 * @returns {Promise<Array<{
 *   rna_id: string,
 *   nom: string,
 *   objet: string,
 *   adresse: string,
 *   code_postal: string,
 *   ville: string,
 *   departement: string,
 *   date_creation: string | null,
 * }>>}
 */
export async function fetchRnaData(options = {}) {
    const baseUrl = options.baseUrl || process.env.RNA_API_BASE_URL || DEFAULT_RNA_BASE_URL;
    const departments = options.departments || (process.env.RNA_DEPARTMENTS || '').split(',').filter(Boolean);
    const globalLimit = options.limit || MAX_ITEMS;

    if (departments.length === 0) {
        logger.warn('[RNA] No departments configured — set RNA_DEPARTMENTS env var');
        return [];
    }

    logger.info(`[RNA] Fetching from ${baseUrl} (departments: ${departments.join(',')})`);

    /** @type {Array<ReturnType<typeof fetchRnaData> extends Promise<(infer T)[]> ? T : never>} */
    const allItems = [];

    // RNA department-to-name mapping for search queries
    const DEPT_NAMES = {
        '67': 'Bas-Rhin',
        '68': 'Haut-Rhin',
        '57': 'Moselle',
        '54': 'Meurthe-et-Moselle',
        '55': 'Meuse',
        '88': 'Vosges',
        '10': 'Aube',
        '51': 'Marne',
        '52': 'Haute-Marne',
        '08': 'Ardennes',
    };

    for (const dept of departments) {
        if (allItems.length >= globalLimit) break;

        const searchQuery = DEPT_NAMES[dept] || dept;
        let page = 1;
        let hasMore = true;

        logger.info(`[RNA] Searching department ${dept} (query: "${searchQuery}")`);

        while (hasMore && allItems.length < globalLimit) {
            const url = `${baseUrl}/full_text/${encodeURIComponent(searchQuery)}?per_page=${PER_PAGE}&page=${page}`;

            try {
                const data = await fetchJson(url);
                const associations = data?.association || [];

                if (!Array.isArray(associations) || associations.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const assoc of associations) {
                    if (allItems.length >= globalLimit) break;

                    const rnaId = safe(assoc.id_association || assoc.id);
                    if (!rnaId || !rnaId.startsWith('W')) continue; // RNA IDs start with W

                    // Build address from available fields
                    const adresseParts = [
                        safe(assoc.adresse_numero_voie),
                        safe(assoc.adresse_type_voie),
                        safe(assoc.adresse_libelle_voie),
                    ].filter(Boolean);

                    const cp = safe(assoc.adresse_code_postal);
                    const ville = safe(assoc.adresse_libelle_commune);

                    // Skip if not matching department (cross-check)
                    const cpDept = cp.substring(0, 2);
                    if (departments.length > 0 && cpDept && !departments.includes(cpDept)) {
                        continue;
                    }

                    allItems.push({
                        rna_id: rnaId,
                        nom: safe(assoc.titre || assoc.titre_court) || 'Association sans nom',
                        objet: safe(assoc.objet || '').substring(0, 1000),
                        adresse: adresseParts.join(' ').trim(),
                        code_postal: cp,
                        ville,
                        departement: cpDept || dept,
                        date_creation: safe(assoc.date_creation) || null,
                    });
                }

                // RNA API: if we got fewer than per_page, no more pages
                hasMore = associations.length >= PER_PAGE;
                page++;

                // Safety: max 20 pages per department to avoid infinite loops
                if (page > 20) {
                    logger.warn(`[RNA] Max page limit (20) reached for department ${dept}`);
                    hasMore = false;
                }
            } catch (err) {
                logger.error(`[RNA] Error fetching page ${page} for dept ${dept}: ${err.message}`);
                hasMore = false;
            }
        }

        logger.info(`[RNA] Department ${dept}: ${allItems.length} total items so far`);
    }

    logger.info(`[RNA] Total items: ${allItems.length}`);
    return allItems;
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';

export function createRnaContractConnector() {
  // RNA is function-based (fetchRnaData), not class-based — use lightweight adapter
  const legacyShim = {
    name: 'rna',
    baseUrl: 'https://entreprise.data.gouv.fr/api/rna/v1',
    getDetailUrls: async () => [],
    fetch: async () => '',
    parse: async () => null,
    getStableId: (item) => item.id_association || item.id
  };
  return new ConnectorContractAdapter(legacyShim, {
    sourceId: 'rna',
    name: 'RNA Connector',
    version: '1.0.0',
    entityType: 'Structure',
    capabilities: ['DIRECTORY']
  });
}
