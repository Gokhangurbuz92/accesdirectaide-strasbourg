// @ts-nocheck
import { visibleWhere } from '../lib/publicVisibility.js';
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { hybridSearchSchema } from '../_utils/validators.js';
import { searchAidesHybrid } from '../lib/hybrid-search.js';
import { generateEmbedding, getActiveEmbeddingModel } from '../lib/EmbeddingProvider.js';
import { cachedSearch } from '../lib/search-cache.js';
import { GLOSSAIRE } from '../lib/glossaire.js';

/**
 * Universal search handler — searches Aides, Démarches, Structures, Actualités.
 * Returns results grouped by type.
 *
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('SEARCH_AIDES', ip);
    if (!rateLimit.allowed) {
      return res.status(429).json({ 
        error: "Trop de requêtes.",
        message: "Pour garantir l'accès à tous, veuillez patienter une minute."
      });
    }

    const validation = hybridSearchSchema.safeParse(req.body || {});
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid payload',
        details: validation.error.format(),
      });
    }

    const payload = validation.data;

    // Cache key params (exclude embedding since it's derived from query)
    const cacheParams = {
      query: payload.query,
      category: payload.category || null,
      situations: payload.situations || [],
      geoScope: payload.geoScope || null,
      territory: payload.territory || null,
      limit: payload.limit || 10,
    };

    // R12 (P08): the commune's hierarchy (commune → EPCI → département → région → national) selects the applicable aides before ranking
    let territoryFilter = null;
    if (payload.territory) {
      const { getHierarchy } = await import('../lib/geography/TerritoryService.js');
      const schemas = await import('../../src/db/schema.js');
      const { hierarchy } = await getHierarchy(payload.territory.toUpperCase(), db, schemas);
      if (hierarchy && hierarchy.length > 0) territoryFilter = { userTerritoryIds: hierarchy.map((h) => h.id) };
    }

    const { data: searchResult, cached } = await cachedSearch(cacheParams, async () => {
      // R14: a section whose query failed is named (it used to be an empty list, « no result », and was cached for 5 minutes)
      const partial = [];
      let embedding = null;
      try {
        embedding = await generateEmbedding(payload.query);
      } catch (embeddingError) {
        logger.warn('[search] embedding generation failed, continuing lexical-only', embeddingError.message);
      }

      // 1. Search Aides (existing hybrid search)
      const { items: aideItems, total: aideTotal, weakResult } = await searchAidesHybrid({
        query: payload.query,
        category: payload.category,
        situations: payload.situations,
        geoScope: payload.geoScope,
        limit: payload.limit,
        embedding,
        embeddingModel: getActiveEmbeddingModel(), // Lock to CANONICAL_MODEL for safety
        territoryFilter
      });

      // 2. Search Démarches (simple text search)
      const queryLike = `%${payload.query}%`;
      let demarches = [];
      try {
        demarches = await db.query.Demarche.findMany({
          where: (d, { or, and, ilike }) => and(
            visibleWhere(d, 'demarche'),   // D-5 (this query had no status filter at all)
            or(
              ilike(d.titre, queryLike),
              ilike(d.description_courte, queryLike),
              ilike(d.contenu_detaille, queryLike)
            )
          ),
          columns: {
            id: true,
            slug: true,
            titre: true,
            description_courte: true,
            categorie: true,
            summary_falc: true,
          },
          limit: 5,
        });
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] demarches search failed:', e.message); partial.push('demarches');
      }

      // 3. Search Structures (simple text search)
      let structures = [];
      try {
        structures = await db.query.Structure.findMany({
          where: (s, { or, and, ilike }) => and(
            visibleWhere(s, 'structure'),   // D-5 (this query had no status filter at all)
            or(
              ilike(s.nom, queryLike),
              ilike(s.description_courte, queryLike),
              ilike(s.ville, queryLike)
            )
          ),
          columns: {
            id: true,
            slug: true,
            nom: true,
            description_courte: true,
            type_structure: true,
            ville: true,
            code_postal: true,
          },
          limit: 5,
        });
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] structures search failed:', e.message); partial.push('structures');
      }

      // 4. Search Actualités (simple text search)
      let actualites = [];
      try {
        actualites = await db.query.Actualite.findMany({
          where: (a, { and, or, ilike, eq }) => and(
            eq(a.statut, 'publie'),
            or(
              ilike(a.titre, queryLike),
              ilike(a.resume, queryLike)
            )
          ),
          columns: {
            id: true,
            slug: true,
            titre: true,
            resume: true,
            categorie: true,
            date_publication: true,
            summary_falc: true,
          },
          limit: 5,
          orderBy: (a, { desc }) => [desc(a.date_publication)],
        });
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] actualites search failed:', e.message); partial.push('actualites');
      }

      const totalResults = aideTotal + demarches.length + structures.length + actualites.length;

      // 5. Match Glossaire terms
      const queryLower = payload.query.toLowerCase();
      const glossaireResults = GLOSSAIRE
        .filter(g =>
          g.terme.toLowerCase().includes(queryLower) ||
          g.definition.toLowerCase().includes(queryLower),
        )
        .slice(0, 3)
        .map(g => ({
          id: g.terme,
          title: g.terme,
          description: g.definition,
          category: g.categorie,
          url: `/glossaire#${g.terme}`,
          type: 'glossaire',
        }));

      if (totalResults === 0 && glossaireResults.length === 0 && (weakResult && demarches.length === 0 && structures.length === 0 && actualites.length === 0)) {
        return {
          items: [],
          total: 0,
          demarches: [],
          structures: [],
          actualites: [],
          glossaire: [],
          message: 'not found',
        };
      }

      return {
        items: aideItems,
        total: aideTotal,
        demarches: demarches.map(d => ({
          id: d.id,
          slug: d.slug,
          title: d.titre,
          description: d.description_courte,
          category: d.categorie,
          type: 'demarche',
        })),
        structures: structures.map(s => ({
          id: s.id,
          slug: s.slug,
          title: s.nom,
          description: s.description_courte,
          category: s.type_structure,
          ville: s.ville,
          type: 'structure',
        })),
        actualites: actualites.map(a => ({
          id: a.id,
          slug: a.slug,
          title: a.titre,
          description: a.resume,
          category: a.categorie,
          date: a.date_publication,
          type: 'actualite',
        })),
        glossaire: glossaireResults,
        message: partial.length ? 'Une partie de la recherche est momentanément indisponible : les résultats affichés sont incomplets.' : null,
        ...(partial.length ? { partial } : {}),
      };
    });

    return res.status(200).json({ ...searchResult, cached });
  } catch (error) {
    logger.error('Search handler error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}
