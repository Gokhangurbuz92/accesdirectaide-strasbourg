// @ts-nocheck
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { hybridSearchSchema } from '../_utils/validators.js';
import { searchAidesHybrid } from '../lib/hybrid-search.js';
import { generateEmbedding, getActiveEmbeddingModel } from '../lib/EmbeddingProvider.js';
import { cachedSearch } from '../lib/search-cache.js';
import { GLOSSAIRE } from '../lib/glossaire.js';
import { bestMatchCondition, searchDemarches, searchStructures, searchWords, wordPlan } from '../lib/search-query.js';
import { crossLanguageQuery } from '../lib/search-crosslanguage.js';
import { structureTypeHint } from '../lib/search-structure-type.js';
import { safetySignal } from '../lib/search-safety.js';
import { guideOffices } from '../lib/official-offices.js';
import { sql } from 'drizzle-orm';

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

    // R32: a query typed in another language becomes French search words (api/lib/search-crosslanguage.js: « kira yardımı », « إيجار »,
    // « допомога на оренду » → « loyer »). A query of which no word is understood gets NO result: before, an Arabic or Cyrillic query had no usable
    // word and the démarches and places sections listed their first records as if they matched.
    const cross = crossLanguageQuery(payload.query, payload.lang || 'fr');
    // R34: a query that describes danger gets the official emergency numbers, whatever else is found (api/lib/search-safety.js)
    const safety = safetySignal(payload.query, cross.changed ? cross.query : '');
    const safe = safety ? { safety: { kind: safety.kind, numbers: safety.numbers } } : {};
    // a danger searches its French topic too: « my husband hits me » finds the guide on domestic violence and the victim offices; « je veux en finir » has
    // no searchable word of its own (only « finir »)
    if (safety && (cross.changed || (payload.lang && payload.lang !== 'fr'))) { cross.query = safety.topic; cross.changed = true; }
    else if (safety) payload.query = `${safety.topic} ${payload.query}`;
    if (cross.changed && !searchWords(cross.query).length) {
      return res.status(200).json({ items: [], demarches: [], structures: [], actualites: [], guides: [], glossaire: [], cached: false, crossLanguage: { understood: false, concepts: [] }, ...safe });
    }
    const crossLanguage = cross.changed ? { understood: true, query: cross.query, concepts: cross.concepts } : undefined;
    if (cross.changed) payload.query = cross.query;

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

      // 2-4. R31 (D16): démarches, places and news use the word search of their own list pages (api/lib/search-query.js, R27): each meaningful word, its
      // synonyms and plural, accents ignored, best match level. Before, the whole query was one ILIKE phrase: « demande logement social », « MDPH Strasbourg »
      // found no démarche or place (D16, 40 catalogue queries replayed read-only on production data, 31/10/2026: démarches recall@5 0.42 → 0.89, places 0.17 → 0.83).
      let demarches = [];
      try {
        demarches = (await searchDemarches({ q: payload.query, page: 1, pageSize: 5 })).items
          .map((d) => ({ id: d.id, slug: d.slug, titre: d.titre, description_courte: d.description_courte, categorie: d.categorie, summary_falc: d.summary_falc }));
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] demarches search failed:', e.message); partial.push('demarches');
      }

      let structures = [];
      try {
        // R33: a query naming a kind of office gets that kind first (Strasbourg first when no place is named), then the ordinary word search
        const hint = structureTypeHint(payload.query);
        let found = [];
        if (hint) {
          for (const attempt of hint.rest ? [{ q: hint.rest }, {}] : [{ city: 'Strasbourg' }, {}]) {
            found = (await searchStructures({ ...attempt, type: hint.type, page: 1, pageSize: 5 })).items;
            if (found.length) break;
          }
        }
        // R34: danger → the offices that receive victims (Strasbourg first), before any place that merely shares a word with the query
        if (!hint && safety) {
          for (const type of safety.structureTypes) {
            for (const attempt of [{ city: 'Strasbourg' }, {}]) {
              const items = (await searchStructures({ ...attempt, type, page: 1, pageSize: 3 })).items;
              if (items.length) { found.push(...items.filter((x) => !found.some((f) => f.id === x.id))); break; }
            }
          }
          found = found.slice(0, 5);
        }
        if (!found.length) found = (await searchStructures({ q: payload.query, sort: 'pertinence', page: 1, pageSize: 5 })).items;
        structures = found
          .map((s) => ({ id: s.id, slug: s.slug, nom: s.nom, description_courte: s.description_courte, type_structure: s.type_structure, ville: s.ville, code_postal: s.code_postal }));
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] structures search failed:', e.message); partial.push('structures');
      }

      let actualites = [];
      try {
        const plan = wordPlan(payload.query, ['"titre"', '"resume"'], '"titre"', false);
        if (plan) {
          const published = [sql`"statut" = 'publie'`];
          const best = await bestMatchCondition('Actualite', published, plan);
          const res = await db.execute(sql`SELECT id, slug, titre, resume, categorie, date_publication, summary_falc FROM "Actualite"
            WHERE ${sql.join([...published, best], sql.raw(' AND '))} ORDER BY ${plan.titleHits} DESC, date_publication DESC NULLS LAST LIMIT 5`);
          actualites = res.rows || res;
        }
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] actualites search failed:', e.message); partial.push('actualites');
      }

      // R33: the official Service-Public guides (verbatim sheets) answer needs that have no aide or démarche (tutelle, curatelle, violences…)
      let guides = [];
      try {
        const plan = wordPlan(payload.query, ['"titre"', `"contenu_json"->>'intro'`, `array_to_string("contexte", ' ')`, `array_to_string("mots_cles", ' ')`], '"titre"', false);
        if (plan) {
          const published = [sql`"statut" = 'publie'`];
          const best = await bestMatchCondition('Guide', published, plan);
          const res = await db.execute(sql`SELECT id, slug, titre, categorie, "contenu_json"->>'intro' AS intro, ${plan.titleHits} AS title_hits FROM "Guide"
            WHERE ${sql.join([...published, best], sql.raw(' AND '))} ORDER BY ${plan.titleHits} DESC, titre ASC LIMIT 5`);
          guides = res.rows || res;
        }
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] guides search failed:', e.message); partial.push('guides');
      }

      // R34 / D16: where the administration says to go. When the best guide's TITLE matches the query, the offices its Service-Public sheet names
      // (OuSAdresser, data/reference/guide-offices.v1.json) come first, Strasbourg first — « curatelle » offered points d'information seniors before.
      try {
        const top = guides[0];
        const sheet = top && Number(top.title_hits) > 0 && !structureTypeHint(payload.query) && !(safety && safety.structureTypes.length) ? guideOffices()[String(top.slug).split('-').pop().toUpperCase()] : null;
        if (sheet && !structures.some((x) => sheet.types.includes(x.type_structure))) {
          const official = [];
          for (const type of sheet.types) {
            for (const attempt of [{ city: 'Strasbourg' }, {}]) {
              const items = (await searchStructures({ ...attempt, type, page: 1, pageSize: 2 })).items;
              if (items.length) { official.push(...items); break; }
            }
            if (official.length >= 3) break;
          }
          if (official.length) {
            structures = [...official.map((x) => ({ id: x.id, slug: x.slug, nom: x.nom, description_courte: x.description_courte, type_structure: x.type_structure, ville: x.ville, code_postal: x.code_postal })),
              ...structures.filter((x) => !official.some((o) => o.id === x.id))].slice(0, 5);
          }
        }
      } catch (e) {
        // @ts-ignore
        logger.warn('[search] official offices failed:', e.message);
      }

      const totalResults = aideTotal + demarches.length + structures.length + actualites.length + guides.length;

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

      if (totalResults === 0 && glossaireResults.length === 0 && (weakResult && demarches.length === 0 && structures.length === 0 && actualites.length === 0 && guides.length === 0)) {
        return {
          items: [],
          total: 0,
          demarches: [],
          structures: [],
          actualites: [],
          guides: [],
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
        guides: guides.map((g) => ({ id: g.id, slug: g.slug, title: g.titre, description: g.intro, category: g.categorie, type: 'guide' })),
        glossaire: glossaireResults,
        message: partial.length ? 'Une partie de la recherche est momentanément indisponible : les résultats affichés sont incomplets.' : null,
        ...(partial.length ? { partial } : {}),
      };
    });

    return res.status(200).json({ ...searchResult, cached, ...(crossLanguage ? { crossLanguage } : {}), ...safe });
  } catch (error) {
    logger.error('Search handler error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}
