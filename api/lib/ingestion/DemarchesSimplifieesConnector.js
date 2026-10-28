// @ts-nocheck
import { logger } from '../logger.js';
/**
 * DemarchesSimplifieesConnector — Connecteur GraphQL pour l'API Démarches Simplifiées.
 *
 * Source : https://www.demarches-simplifiees.fr/api/v2/graphql
 * Auth   : Bearer token via DS_GRAPHQL_TOKEN
 * Guard  : ENABLE_DS_INGESTION=true (désactivé par défaut)
 *
 * Stratégie : Requête GraphQL pour récupérer les démarches par numéro,
 *             enrichit la table Demarche avec contenu_detaille et lien_teleservice.
 *
 * Résilience : Retry avec backoff, timeout 10s, graceful skip si token absent.
 */

const DEFAULT_DS_API_URL = 'https://www.demarches-simplifiees.fr/api/v2/graphql';
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

/**
 * IDs de démarches sociales connues sur Démarches Simplifiées.
 * Ces numéros correspondent à des formulaires d'aides sociales fréquemment utilisés.
 * Extensible via variable d'environnement DS_DEMARCHE_IDS (comma-separated).
 */
const DEFAULT_DEMARCHE_IDS = [
    // Exemples de démarches sociales publiques
    // Ces IDs doivent être ajustés avec les vrais numéros de démarches pertinentes
];

/**
 * GraphQL query to fetch a démarche by its number.
 */
const DEMARCHE_QUERY = `
  query getDemarche($demarcheNumber: Int!) {
    demarche(number: $demarcheNumber) {
      id
      number
      title
      description
      state
      declarative
      dateCreation
      dateFermeture
      service {
        nom
        typeOrganisme
      }
      dempiUrl
    }
  }
`;

/**
 * @param {string} url
 * @param {string} token
 * @param {string} query
 * @param {object} variables
 * @param {number} [retries]
 * @returns {Promise<object>}
 */
async function graphqlFetch(url, token, query, variables, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'AccesDirectAideBot/1.0',
                },
                body: JSON.stringify({ query, variables }),
            });
            clearTimeout(timer);

            if (!response.ok) {
                // 401/403 = bad token — don't retry
                if (response.status === 401 || response.status === 403) {
                    throw new Error(`DS API auth error: ${response.status}`);
                }
                throw new Error(`DS API HTTP ${response.status} ${response.statusText}`);
            }

            const json = await response.json();

            if (json.errors && json.errors.length > 0) {
                const errMsg = json.errors.map((/** @type {{ message: string | number | boolean | null | undefined }} */ e) => e.message).join('; ');
                throw new Error(`DS GraphQL error: ${errMsg}`);
            }

            return json.data;
        } catch (err) {
            if (err.message.includes('auth error') || attempt === retries - 1) throw err;
            const delay = 1000 * Math.pow(2, attempt);
            logger.warn(`[DS] Retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw new Error('[DS] All retries exhausted');
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
 * Fetch démarches from the Démarches Simplifiées GraphQL API.
 *
 * @param {{
 *   demarcheIds?: number[],
 *   apiUrl?: string,
 *   token?: string,
 * }} options
 * @returns {Promise<Array<{
 *   external_id: string,
 *   titre: string,
 *   description_courte: string,
 *   contenu_detaille: string,
 *   lien_teleservice: string | null,
 *   lien_officiel: string,
 *   categorie: string,
 *   source_api: string,
 *   source_url: string,
 *   service_nom: string | null,
 *   state: string,
 * }>>}
 */
export async function fetchDemarchesSimplifiees(options = {}) {
    const apiUrl = options.apiUrl || process.env.DS_API_URL || DEFAULT_DS_API_URL;
    const token = options.token || process.env.DS_GRAPHQL_TOKEN;
    const enabled = process.env.ENABLE_DS_INGESTION === 'true';

    // Guard: skip if not enabled or no token
    if (!enabled) {
        logger.info('[DS] Ingestion désactivée (ENABLE_DS_INGESTION != true). Skipping.');
        return [];
    }

    if (!token) {
        logger.warn('[DS] DS_GRAPHQL_TOKEN manquant. Skipping ingestion.');
        return [];
    }

    const demarcheIds = options.demarcheIds
        || (process.env.DS_DEMARCHE_IDS || '').split(',').filter(Boolean).map(Number)
        || DEFAULT_DEMARCHE_IDS;

    if (demarcheIds.length === 0) {
        logger.warn('[DS] Aucun ID de démarche configuré (DS_DEMARCHE_IDS). Skipping.');
        return [];
    }

    logger.info(`[DS] Fetching ${demarcheIds.length} démarches from ${apiUrl}`);

    /** @type {ReturnType<typeof fetchDemarchesSimplifiees> extends Promise<infer T> ? T : never} */
    const items = [];

    for (const demarcheId of demarcheIds) {
        try {
            const data = await graphqlFetch(apiUrl, token, DEMARCHE_QUERY, {
                demarcheNumber: demarcheId,
            });

            const d = data?.demarche;
            if (!d) {
                logger.warn(`[DS] Démarche #${demarcheId}: not found`);
                continue;
            }

            // Skip closed/draft démarches
            const state = safe(d.state);
            if (state === 'close' || state === 'brouillon') {
                logger.info(`[DS] Démarche #${demarcheId}: state=${state}, skipping`);
                continue;
            }

            const titre = safe(d.title) || `Démarche DS #${demarcheId}`;
            const description = safe(d.description);

            items.push({
                external_id: `ds-${demarcheId}`,
                titre,
                description_courte: description.substring(0, 500),
                contenu_detaille: description,
                lien_teleservice: d.dempiUrl || `https://www.demarches-simplifiees.fr/commencer/${demarcheId}`,
                lien_officiel: `https://www.demarches-simplifiees.fr/commencer/${demarcheId}`,
                categorie: 'administratif',
                source_api: 'demarches-simplifiees',
                source_url: `https://www.demarches-simplifiees.fr/commencer/${demarcheId}`,
                service_nom: d.service?.nom || null,
                state,
            });
        } catch (err) {
            logger.error(`[DS] Démarche #${demarcheId} error: ${err.message}`);
            // Continue with other démarches
        }
    }

    logger.info(`[DS] Fetched ${items.length} démarches`);
    return items;
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';

export function createDemarchesSimplifieesContractConnector() {
  const legacyShim = {
    name: 'demarches-simplifiees',
    baseUrl: 'https://www.demarches-simplifiees.fr',
    getDetailUrls: async () => [],
    fetch: async () => '',
    parse: async () => null,
    getStableId: (item) => item.number || item.id
  };
  return new ConnectorContractAdapter(legacyShim, {
    sourceId: 'demarches-simplifiees',
    name: 'Demarches Simplifiees Connector',
    version: '1.0.0',
    entityType: 'Demarche',
    capabilities: ['PROCEDURAL']
  });
}
