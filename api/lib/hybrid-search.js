// @ts-nocheck
import { visibleSql } from './publicVisibility.js';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';

const RRF_K = 60;
const LEXICAL_CANDIDATE_MULTIPLIER = 5;
const SEMANTIC_CANDIDATE_MULTIPLIER = 5;
const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

let capabilityCache = {
  checkedAt: 0,
  hasEmbeddingColumn: false,
  hasVectorExtension: false,
  hasTsContentColumn: false,
  hasSearchVectorColumn: false,
  hasUnaccentExtension: false,
};

function toVectorLiteral(/** @type {Array<string | number | boolean | null | undefined>} */ values) {
  return `[${values.map((/** @type {string | number | boolean | null | undefined} */ value) => Number(value).toFixed(8)).join(',')}]`;
}

async function getSearchCapabilities() {
  const now = Date.now();
  if (now - capabilityCache.checkedAt < CAPABILITY_CACHE_TTL_MS) {
    return capabilityCache;
  }

  try {
    const rows = await db.execute(sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'Aide'
            AND column_name = 'embedding'
        ) AS has_embedding_column,
        EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'vector'
        ) AS has_vector_extension,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'Aide'
            AND column_name = 'ts_content'
        ) AS has_ts_content_column,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'Aide'
            AND column_name = 'search_vector'
        ) AS has_search_vector_column,
        EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'unaccent'
        ) AS has_unaccent_extension
    `);

    const actualRows = rows.rows || rows;
    const row = actualRows?.[0] || {};
    capabilityCache = {
      checkedAt: now,
      hasEmbeddingColumn: Boolean(row.has_embedding_column),
      hasVectorExtension: Boolean(row.has_vector_extension),
      hasTsContentColumn: Boolean(row.has_ts_content_column),
      hasSearchVectorColumn: Boolean(row.has_search_vector_column),
      hasUnaccentExtension: Boolean(row.has_unaccent_extension),
    };
  } catch {
    capabilityCache = {
      checkedAt: now,
      hasEmbeddingColumn: false,
      hasVectorExtension: false,
      hasTsContentColumn: false,
      hasSearchVectorColumn: false,
      hasUnaccentExtension: false,
    };
  }

  return capabilityCache;
}

// @ts-ignore
function buildAideFilters({ category, situations, geoScope }) {
  const filters = [
    // D-5: published AND verified/current/eligible (the former status_code OR statut clause let unverified and held records into retrieval)
    visibleSql('aide', { alias: 'a' }),
  ];

  if (category) {
    const categorySlug = String(category).toLowerCase();
    filters.push(sql`
      (
        a."category_code" = CAST(${category} AS "AidCategoryCode")
        OR a."theme" = ${categorySlug}
        OR a."categorie" = ${categorySlug}
        OR EXISTS (
          SELECT 1
          FROM "AidCategory" category
          WHERE category.id = a."categoryId"
            AND category.slug = ${categorySlug}
        )
      )
    `);
  }

  if (geoScope) {
    filters.push(sql`a."geo_scope" = ${geoScope}`);
  }

  if (situations && situations.length > 0) {
    filters.push(sql`
      (
        EXISTS (
          SELECT 1
          FROM "AidSituation" relation
          JOIN "Situation" situation ON situation.id = relation."situationId"
          WHERE relation."aidId" = a.id
            AND situation.code IN (${sql.join(situations)})
        )
        OR EXISTS (
          SELECT 1
          FROM "_AideToLifeSituation" relation
          JOIN "LifeSituation" situation ON situation.id = relation."A"
          WHERE relation."B" = a.id
            AND situation.slug IN (${sql.join(situations)})
        )
      )
    `);
  }

  return sql`${sql.join(filters, sql.raw(' AND '))}`;
}

function normalizeRows(rows) {
  return rows.map((/** @type {{ category: string | number | boolean | null | undefined, citations: string | number | boolean | null | undefined, date_verification: string | number | boolean | null | undefined, description: string | number | boolean | null | undefined, id: string | number | boolean | null | undefined, lexical_score: string | number | boolean | null | undefined, rrf_score: string | number | boolean | null | undefined, semantic_score: string | number | boolean | null | undefined, slug: string | number | boolean | null | undefined, source_url: string | number | boolean | null | undefined, source_url_exact: string | number | boolean | null | undefined, status: string | number | boolean | null | undefined, title: string | number | boolean | null | undefined }} */ row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    titre: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    citations: row.citations || [],
    // Preserve stored provenance; absence is not a verification claim.
    source_url: row.source_url ?? null,
    source_url_exact: row.source_url_exact ?? null,
    date_verification: row.date_verification ?? null,
    score: Number(row.rrf_score || 0),
    lexicalScore: row.lexical_score === null ? null : Number(row.lexical_score),
    semanticScore: row.semantic_score === null ? null : Number(row.semantic_score),
  }));
}

export async function searchAidesHybrid(params) {
  const { query, category, situations = [], geoScope, limit = 10, embedding = null, embeddingModel = null, territoryFilter = null } = params;
  const lexicalLimit = Math.max(limit * LEXICAL_CANDIDATE_MULTIPLIER, limit);
  const semanticLimit = Math.max(limit * SEMANTIC_CANDIDATE_MULTIPLIER, limit);
  const filters = buildAideFilters({ category, situations, geoScope });

  // Phase 9: Apply territory applicability pre-filtering BEFORE ranking (FR-014)
  // Narrowest rule wins; at the same depth, exclusion wins over inclusion.
  if (territoryFilter && territoryFilter.userTerritoryIds && territoryFilter.userTerritoryIds.length > 0) {
    const territoryIds = territoryFilter.userTerritoryIds;
    const valuesList = sql.join(territoryIds.map((/** @type {string | number | boolean | null | undefined} */ id, /** @type {string | number | boolean | null | undefined} */ idx) => sql`(${id}::text, ${idx}::int)`), sql`, `);

    filters.append(sql`
      AND (
        NOT EXISTS (SELECT 1 FROM "Applicability" app WHERE app.entity_type = 'BENEFIT' AND app.entity_id = a.id)
        OR (
          SELECT app.is_exclusion 
          FROM "Applicability" app
          JOIN (VALUES ${valuesList}) AS t(tid, depth) ON app.territory_id = t.tid
          WHERE app.entity_type = 'BENEFIT' AND app.entity_id = a.id
          ORDER BY t.depth ASC, app.is_exclusion DESC
          LIMIT 1
        ) = false
      )
    `);
  }
  const vectorLiteral = Array.isArray(embedding) && embedding.length > 0 ? toVectorLiteral(embedding) : null;

  const capabilities = await getSearchCapabilities();
  const semanticReady = vectorLiteral
    ? capabilities.hasEmbeddingColumn && capabilities.hasVectorExtension
    : false;

  const tsQuery = capabilities.hasUnaccentExtension
    ? sql`websearch_to_tsquery('french', unaccent(${query}))`
    : sql`websearch_to_tsquery('french', ${query})`;

  const canUseTsContent = capabilities.hasTsContentColumn;
  const canUseSearchVector = capabilities.hasSearchVectorColumn;

  // PKG-11 / D16: without a stored lexical column (the case of this schema) the vector is computed from the record's own texts, and the query is an OR of its
  // French lexemes ranked by ts_rank_cd (a record matching more words ranks higher). Before, the fallback was ILIKE '%<whole query>%' on the title and the
  // description: a natural question (« aide pour payer mon loyer ») found nothing — recall@5 0.19 on the evaluation set.
  const docText = sql`concat_ws(' ', a.titre, a.cest_quoi, a.pour_qui, a.ce_que_ca_aide, a.summary_falc, array_to_string(a.mots_cles, ' '))`;
  const computedVector = capabilities.hasUnaccentExtension ? sql`to_tsvector('french', unaccent(${docText}))` : sql`to_tsvector('french', ${docText})`;
  const anyWordQuery = capabilities.hasUnaccentExtension
    ? sql`NULLIF(replace(plainto_tsquery('french', unaccent(${query}))::text, ' & ', ' | '), '')::tsquery`
    : sql`NULLIF(replace(plainto_tsquery('french', ${query})::text, ' & ', ' | '), '')::tsquery`;
  const storedVector = canUseTsContent && canUseSearchVector
    ? sql`(COALESCE(a."ts_content", to_tsvector('french', '')) || COALESCE(a."search_vector", to_tsvector('french', '')))`
    : canUseTsContent
      ? sql`COALESCE(a."ts_content", to_tsvector('french', ''))`
      : canUseSearchVector
        ? sql`COALESCE(a."search_vector", to_tsvector('french', ''))`
        : null;
  const lexicalVector = storedVector || computedVector;
  const lexicalQuery = storedVector ? tsQuery : anyWordQuery;

  const lexicalCte = sql`
      lexical AS (
        SELECT
          a.id,
          ts_rank_cd(${lexicalVector}, ${lexicalQuery}) AS lexical_score,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(${lexicalVector}, ${lexicalQuery}) DESC, a.id ASC
          ) AS lexical_rank
        FROM "Aide" a
        WHERE ${filters}
          AND ${lexicalVector} @@ ${lexicalQuery}
        LIMIT ${lexicalLimit}
      )
    `;

  const semanticFilter = embeddingModel 
    ? sql`AND a."embedding_model" = ${embeddingModel}`
    : sql``;

  const semanticCte = semanticReady
    ? sql`
      semantic AS (
        SELECT
          a.id,
          1 - (a."embedding" <=> CAST(${vectorLiteral} AS vector)) AS semantic_score,
          ROW_NUMBER() OVER (ORDER BY a."embedding" <=> CAST(${vectorLiteral} AS vector) ASC, a.id ASC) AS semantic_rank
        FROM "Aide" a
        WHERE ${filters}
          AND a."embedding" IS NOT NULL
          ${semanticFilter}
        LIMIT ${semanticLimit}
      )
    `
    : sql`
      semantic AS (
        SELECT
          NULL::text AS id,
          NULL::double precision AS semantic_score,
          NULL::bigint AS semantic_rank
        WHERE FALSE
      )
    `;

  const fusionSql = sql`
    WITH
      ${lexicalCte},
      ${semanticCte},
      fused AS (
        SELECT
          COALESCE(lexical.id, semantic.id) AS id,
          lexical.lexical_score,
          semantic.semantic_score,
          (
            CASE WHEN lexical.lexical_rank IS NULL THEN 0 ELSE 1.0 / (${RRF_K} + lexical.lexical_rank) END +
            CASE WHEN semantic.semantic_rank IS NULL THEN 0 ELSE 1.0 / (${RRF_K} + semantic.semantic_rank) END
          ) AS rrf_score
        FROM lexical
        FULL OUTER JOIN semantic ON lexical.id = semantic.id
      )
    SELECT
      aide.id,
      aide.slug,
      COALESCE(aide."title", aide.titre) AS title,
      COALESCE(aide."description", aide.cest_quoi) AS description,
      -- PKG-11 audit: category_code defaults to AUTRE and is not maintained by the catalogue import; the catalogue's categorie (same vocabulary) wins when valid
      CASE WHEN upper(aide.categorie) IN ('LOGEMENT','SANTE','HANDICAP','EMPLOI','FAMILLE','ETUDES','MOBILITE','ENERGIE','ALIMENTATION','JUSTICE','NUMERIQUE','AUTRE') THEN upper(aide.categorie) ELSE aide."category_code"::text END AS category,
      -- PKG-11 audit: status_code is not maintained by the publication workflow (a published, verified aide read « DRAFT »); results are already D-5 filtered,
      -- so the status a caller sees is the publication state the rest of the product uses (statut), archive decisions kept
      CASE WHEN aide."status_code"::text = 'ARCHIVED' THEN 'ARCHIVED' WHEN aide.statut = 'publie' THEN 'PUBLISHED' ELSE aide."status_code"::text END AS status,
      aide.citations,
      aide.source_url,
      aide.source_url_exact,
      aide.date_verification,
      fused.lexical_score,
      fused.semantic_score,
      fused.rrf_score
    FROM fused
    JOIN "Aide" aide ON aide.id = fused.id
    ORDER BY fused.rrf_score DESC, fused.lexical_score DESC NULLS LAST, fused.semantic_score DESC NULLS LAST, aide.id ASC
    LIMIT ${limit}
  `;

  const result = await db.execute(fusionSql);
  const rows = result.rows || result;
  const items = normalizeRows(rows);

  const topResult = items[0];
  const weakResult = topResult
    ? topResult.score < 0.01 && (topResult.lexicalScore ?? 0) < 0.01 && (topResult.semanticScore ?? 0) < 0.2
    : true;

  return {
    items,
    total: items.length,
    weakResult,
  };
}
