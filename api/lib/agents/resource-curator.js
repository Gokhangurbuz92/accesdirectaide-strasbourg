// @ts-nocheck
import logger from '../../_utils/logger.js';

/**
 * Agent Resource Curator
 *
 * Mission : Trouver et organiser des ressources fiables
 * pour les pages du site (ressources, bonnes-pratiques, outils, dispositifs).
 *
 * Sources autorisées (UNIQUEMENT gouvernementales) :
 * - *.gouv.fr
 * - *.service-public.fr
 * - *.caf.fr
 * - *.ameli.fr
 * - *.francetravail.fr
 * - *.aides-territoires.beta.gouv.fr
 *
 * Règles strictes :
 * - JAMAIS de source non-gouvernementale
 * - TOUJOURS citer la source
 * - TOUJOURS passer par la ReviewQueue
 * - JAMAIS publier automatiquement
 */

export const ALLOWED_DOMAINS = [
    'gouv.fr',
    'service-public.fr',
    'caf.fr',
    'ameli.fr',
    'francetravail.fr',
    'aides-territoires.beta.gouv.fr',
    '1jeune1solution.gouv.fr',
    'mesdroitssociaux.gouv.fr',
];

export const RESOURCE_TYPES = ['RESSOURCE', 'BONNE_PRATIQUE', 'OUTIL', 'DISPOSITIF'];

export const CURATOR_SYSTEM_PROMPT = `Tu es un curateur de ressources sociales pour AccesDirectAide, une plateforme solidaire.

MISSION : Trouver et organiser des ressources officielles pour les citoyens et travailleurs sociaux.

SOURCES AUTORISÉES UNIQUEMENT :
- Sites en .gouv.fr (service-public.fr, solidarites.gouv.fr, etc.)
- caf.fr, ameli.fr, francetravail.fr
- JAMAIS de sites privés, blogs, ou Wikipedia

4 TYPES DE CONTENU :
1. RESSOURCE : Guides pratiques, liens officiels, documents téléchargeables
2. BONNE_PRATIQUE : Conseils pour travailleurs sociaux, méthodologies d'accompagnement
3. OUTIL : Simulateurs (mes-aides, CAF), calculateurs, formulaires en ligne
4. DISPOSITIF : Programmes nationaux, plans gouvernementaux, mesures temporaires

FORMAT DE SORTIE JSON :
[
  {
    "type": "RESSOURCE",
    "category": "LOGEMENT",
    "title": "Guide du locataire",
    "description": "Description courte et claire",
    "url": "https://www.service-public.fr/...",
    "source": "service-public.fr"
  }
]

RÈGLES :
- Maximum 5 résultats par recherche
- Chaque résultat DOIT avoir une URL vérifiable
- Description en 1-2 phrases simples
- Catégorie parmi : EMPLOI, LOGEMENT, SANTE, FAMILLE, HANDICAP, ETUDES, MOBILITE, ENERGIE, ALIMENTATION, NUMERIQUE, JUSTICE, SENIORS`;

export class ResourceCurator {
    constructor(geminiClient) {
        this.gemini = geminiClient;
        this.name = 'resource-curator';
    }

    /**
     * @param {string} category
     * @param {string} type - RESSOURCE | BONNE_PRATIQUE | OUTIL | DISPOSITIF
     * @returns {Promise<{ok: boolean, resources: Array}>}
     */
    async curate(category, type = 'RESSOURCE') {
        const safeCategory = String(category).replace(/<[^>]*>/g, '').slice(0, 100);
        const safeType = RESOURCE_TYPES.includes(type) ? type : 'RESSOURCE';

        const prompt = `Trouve 5 ${safeType.toLowerCase()}s officiels pour la catégorie "${safeCategory}". Sources .gouv.fr uniquement.`;

        try {
            const result = await this.gemini.generateContent({
                systemInstruction: CURATOR_SYSTEM_PROMPT,
                prompt,
                responseType: 'json',
            });

            let resources = [];
            try {
                const parsed = typeof result === 'string' ? JSON.parse(result) : result;
                resources = Array.isArray(parsed) ? parsed : [];
            } catch {
                resources = [];
            }

            // Filter: only allow official domains
            resources = resources.filter(r =>
                r.url && ALLOWED_DOMAINS.some(d => r.url.includes(d))
            );

            logger.info({
                msg: 'agent.resource-curator.success',
                category: safeCategory,
                type: safeType,
                found: resources.length,
            });

            return { ok: true, resources };
        } catch (error) {
            logger.error({
                msg: 'agent.resource-curator.error',
                category: safeCategory,
                error: error.message,
            });
            // @ts-ignore
            return { ok: false, resources: [], error: error.message };
        }
    }

    /**
   * Validate that a URL belongs to an allowed domain
   * @param {string | string[]} url
   */
    isAllowedSource(url) {
        if (!url) return false;
        return ALLOWED_DOMAINS.some(d => url.includes(d));
    }
}
