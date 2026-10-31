// @ts-nocheck
import { decide, visibleSql } from './publicVisibility.js';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { expandQueryWithSynonyms, normalizeSearchTerm } from './search-utils.js';
import { buildProvenance } from '../_utils/provenance.js';

// DTA S3B: `search_vector` is NOT created by any migration of this repository (drizzle/*.sql, src/db/schema*). PostgreSQL resolves a column at parse time, even inside a CASE branch,
// so the former runtime `pg_extension`/`information_schema` CASE guards could not protect the query: on a schema without the column every keyword (`q`) search answered 500
// (native run 2c3060: GET /api/structures?q=CAF). The column (and the unaccent extension it needs) is therefore detected ONCE per table, in JS, and the full-text clause is only built when both exist;
// otherwise the existing ILIKE predicates alone apply. A failed detection is not cached and means "no full-text".
/** @type {Map<string, Promise<boolean>>} */
const SEARCH_VECTOR_CACHE = new Map();
/** @param {string} table @returns {Promise<boolean>} */
export function hasSearchVector(table) {
  if (!SEARCH_VECTOR_CACHE.has(table)) {
    SEARCH_VECTOR_CACHE.set(table, (async () => {
      const res = await db.execute(sql`SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = 'search_vector')
        AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent')) AS ok`);
      const rows = res.rows || res;
      return Boolean(rows[0] && rows[0].ok);
    })().catch(() => { SEARCH_VECTOR_CACHE.delete(table); return false; }));
  }
  return SEARCH_VECTOR_CACHE.get(table);
}
export function resetSearchVectorCache() { SEARCH_VECTOR_CACHE.clear(); }
/** @param {boolean} sv @param {string} v */
const svOr = (sv, v) => (sv ? sql` OR ("search_vector" @@ plainto_tsquery('french', unaccent(${v})))` : sql``);

/** R26: the topics of the Aides menu and the words that put a record under each (written without accents; matched as whole-word starts) */
export const THEME_WORDS = {
  logement: ['logement', 'loyer', 'hlm', 'hebergement'],
  sante: ['sante', 'soins', 'maladie', 'medical'],
  handicap: ['handicap'],
  emploi: ['emploi', 'chomage', 'travail', 'activite', 'entreprise'],
  famille: ['famille', 'enfant', 'parent'],
};
const ACCENTED = 'àâäéèêëîïôöùûüç'; const PLAIN = 'aaaeeeeiioouuuc';
/** @param {unknown} v */
export const foldAccents = (v) => String(v || '').toLowerCase().replace(/[àâäéèêëîïôöùûüç]/g, (c) => PLAIN[ACCENTED.indexOf(c)]);
/** a PostgreSQL regular expression for a topic (\\m = start of a word), or null for a topic without a word list */
export const themePattern = (theme) => (THEME_WORDS[theme] ? `\\m(${THEME_WORDS[theme].join('|')})` : null);
/** a column, lower-cased and without accents, in SQL (a fixed identifier, never user input) @param {string} col */
const FOLDED = (col) => sql.raw(`translate(lower(coalesce(${col}, '')), '${ACCENTED}', '${PLAIN}')`);
/** @param {boolean} sv */
const svFlag = (sv) => (sv ? sql`TRUE` : sql`FALSE`);
/** @param {boolean} sv @param {string} v */
const svRank = (sv, v) => (sv ? sql`ts_rank_cd("search_vector", plainto_tsquery('french', unaccent(${v})))` : sql`0`);

/**
 * Builds and executes a search query for Aides.
 */
/**
 * @param {any} db
 * @param {any} params
 */
export async function searchAides(params) {
  const {
    q,
    theme, sousTheme,
    public: audience,
    territoire: geo,
    organisme: provider,
    urgent,
    statut = 'publie',
    publicOnly = true,
    sort,
    page, pageSize,
    // Legacy mapping
    category, situation, providerType
  } = params;

  const LIMIT = Number(pageSize) || 20;
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;

  // D-5: the public list contains only records that pass the visibility rules; only an authenticated admin caller (publicOnly === false) may choose another statut.
  const conditions = [publicOnly === false ? sql`statut = ${statut}` : visibleSql('aide')];

  const sv = q ? await hasSearchVector('Aide') : false;
  // 1. Full Text Search with Synonym Expansion
  // Use ILIKE fallback when search_vector or unaccent extension is missing
  if (q) {
    const expandedTerms = expandQueryWithSynonyms(q);

    if (expandedTerms.length > 1) {
      const searchConditions = expandedTerms.map(term =>
        sql`("titre" ILIKE ${'%' + term + '%'} OR "cest_quoi" ILIKE ${'%' + term + '%'}${svOr(sv, term)})`
      );
      conditions.push(sql`(${sql.join(searchConditions, sql.raw(' OR '))})`);
    } else {
      conditions.push(sql`(
        ("titre" ILIKE ${'%' + q + '%'}) OR ("cest_quoi" ILIKE ${'%' + q + '%'})
        ${svOr(sv, q)}
      )`);
    }
  }

  // 2. Filters
  const effectiveTheme = theme || category;
  if (effectiveTheme) {
    // Match new 'theme' column OR legacy category relation — R26: OR the record's own category, OR the topic's words in its title and description
    // (accents ignored). The verified records carry a coarse « categorie » and almost never a « theme », so the Aides menu (Logement, Santé, Handicap,
    // Emploi, Famille) returned nothing for every topic.
    const t = foldAccents(effectiveTheme);
    const pattern = themePattern(t);
    conditions.push(sql`("theme" = ${effectiveTheme} OR "categoryId" = ${effectiveTheme} OR EXISTS (SELECT 1 FROM "AidCategory" c WHERE c.id = "Aide"."categoryId" AND c.slug = ${effectiveTheme})
      OR ${FOLDED('"categorie"')} = ${t}${pattern ? sql` OR (${FOLDED('"titre"')} || ' ' || ${FOLDED('"description"')}) ~ ${pattern}` : sql``})`);
  }

  if (sousTheme) {
    conditions.push(sql`"sub_theme" = ${sousTheme}`);
  }

  const effectiveAudience = audience; // 'public' alias
  if (effectiveAudience) {
    conditions.push(sql`${effectiveAudience} = ANY("audiences")`);
  }

  if (situation) {
    // Support both new AidSituation/Situation mapping and legacy LifeSituation mapping.
    conditions.push(sql`(
      EXISTS (
        SELECT 1
        FROM "AidSituation" relation
        JOIN "Situation" situation ON situation.id = relation."situationId"
        WHERE relation."aidId" = "Aide".id
          AND situation.code = ${situation}
      )
      OR EXISTS (
        SELECT 1
        FROM "_AideToLifeSituation" relation
        JOIN "LifeSituation" situation ON situation.id = relation."A"
        WHERE relation."B" = "Aide".id
          AND situation.slug = ${situation}
      )
    )`);
  }

  const effectiveGeo = geo; // 'territoire' alias
  if (effectiveGeo) {
    conditions.push(sql`${effectiveGeo} = ANY("territoires")`);
  }

  if (provider) {
    conditions.push(sql`"providerName" = ${provider}`);
  }

  if (providerType) {
    conditions.push(sql`"providerType" = ${providerType}`);
  }

  if (urgent === 'true') {
    conditions.push(sql`"est_urgent" = true`);
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}`
    : sql``;

  // 3. Sorting - Safe mapping with whitelist
  let orderBy;
  let selectRank = sql``;

  // P2: external sort aliases (stable contract) -> internal implementation
  /** @type {Record<string, string>} */
  const sortAliases = {
    relevance: 'pertinence',
    recent: '-published_at',
    '-recent': 'published_at',
    quality: '-quality_score',
    '-quality': 'quality_score',
  };

  const effectiveSort = sortAliases[sort] || sort;

  // Parse sort parameter (handle prefix "-" for DESC)
  const sortDirection = effectiveSort?.startsWith('-') ? 'DESC' : 'ASC';
  const sortField = effectiveSort?.startsWith('-') ? effectiveSort.substring(1) : effectiveSort;

  // Safe column mapping (whitelist only)
  /** @type {Record<string, string>} */
  const SAFE_SORT_COLUMNS = {
    'date': 'published_at',
    'alpha': 'titre',
    'created_date': 'updatedAt',
    'updated_date': 'updatedAt',
    'published_at': 'published_at',
    'date_publication': 'published_at',
    'titre': 'titre',
    'quality_score': 'quality_score',
  };

  if (q && (effectiveSort === 'pertinence' || sortField === 'pertinence')) {
    selectRank = sql`, CASE WHEN ${svFlag(sv)} THEN ${svRank(sv, q)} ELSE CASE WHEN "titre" ILIKE ${'%' + q + '%'} THEN 2 WHEN "cest_quoi" ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END END as rank`;
    orderBy = sql`ORDER BY rank DESC, published_at DESC, id ASC`;
  } else if (sortField === 'pertinence') {
    // Relevance sorting requires q. Without q we fallback to date.
    orderBy = sql`ORDER BY published_at DESC, id ASC`;
  } else if (sortField && SAFE_SORT_COLUMNS[sortField]) {
    const dbColumn = SAFE_SORT_COLUMNS[sortField];
    const safeColumn = sql.raw(`"${dbColumn}"`);

    // P2: quality sort should remain stable and useful, even when many scores are equal.
    if (dbColumn === 'quality_score') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, published_at DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, published_at DESC, id ASC`;
    } else {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    }
  } else {
    // Default fallback
    orderBy = sql`ORDER BY published_at DESC, id ASC`;
  }

  // 4. Execution
  const itemsQuery = sql`
    SELECT id ${selectRank}
    FROM "Aide"
    ${whereClause}
    ${orderBy}
    LIMIT ${LIMIT} OFFSET ${OFFSET}
  `;

  const countQuery = sql`
    SELECT count(*) as total
    FROM "Aide"
    ${whereClause}
  `;

  // Facets Query (Aggregation)
  // We want counts for themes, organismes, territoires, publics
  // This can be heavy, so we might want to cache or simplify.
  // For now, let's do simple GROUP BYs on the filtered set (except the filter itself? No, standard is filtered set).
  // Actually, standard facet behavior is "drill down", so facets show counts within current results.

  // To avoid huge SQL complexity, we'll fetch basic stats.
  // Note: Aggregating arrays (audiences, territoires) requires UNNEST.

  const facetsQuery = sql`
    SELECT
        (SELECT json_object_agg(t, c) FROM (SELECT "theme" as t, count(*) as c FROM "Aide" ${whereClause} AND "theme" IS NOT NULL GROUP BY "theme") t) as themes,
        (SELECT json_object_agg(p, c) FROM (SELECT "providerName" as p, count(*) as c FROM "Aide" ${whereClause} AND "providerName" IS NOT NULL GROUP BY "providerName") p) as organismes,
        (SELECT json_object_agg(a, c) FROM (SELECT unnest("audiences") as a, count(*) as c FROM "Aide" ${whereClause} GROUP BY a) a) as publics,
        (SELECT json_object_agg(ter, c) FROM (SELECT unnest("territoires") as ter, count(*) as c FROM "Aide" ${whereClause} GROUP BY ter) t) as territoires
  `;

  const [itemsRes, countRes, facetsRes] = await Promise.all([
    db.execute(itemsQuery),
    db.execute(countQuery),
    db.execute(facetsQuery)
  ]);
  const items = itemsRes.rows || itemsRes;
  const countResult = countRes.rows || countRes;
  const facetsResult = facetsRes.rows || facetsRes;

  // Enrich items
  const itemIds = items.map((/** @type {{ id: string }} */ i) => i.id);
  /**
   * @type {({ provenance: { verifiedAt: string | null; fetchedAt: string | null; sourceUrl: string | null; sourceHost: string | null; }; id: string; } | { rank: number | undefined; provenance: { verifiedAt: string | null; fetchedAt: string | null; sourceUrl: string | null; sourceHost: string | null; }; id: string; } | null)[]}
   */
  let enrichedItems = [];
  if (itemIds.length > 0) {
    const fullItems = await db.query.Aide.findMany({
      where: (aide, { inArray }) => inArray(aide.id, itemIds),
      columns: {
        id: true,
        slug: true,
        titre: true,
        categorie: true,
        theme: true,
        sub_theme: true,
        cest_quoi: true,
        summary_falc: true,
        est_urgent: true,
        territoires: true,
        date_verification: true,
        statut: true, launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true,
        quality_score: true,
        published_at: true,
        updatedAt: true,
        providerName: true,
        source_name: true,
        source_org: true,
        source_url: true,
        fetched_at: true,
      },
      with: {
        sourceDocument: {
          columns: {
            fetched_at: true,
            source_url: true,
          },
        },
      },
    });

    const itemMap = new Map(fullItems.map((/** @type {{ id: string }} */ i) => [i.id, i]));
    enrichedItems = items.map((/** @type {{ id: string, rank?: number }} */ raw) => {
      const full = itemMap.get(raw.id);
      if (!full) return null;
      const { sourceDocument, verified_by: _reviewer, publication_hold: _hold, ...safeFull } = full;
      const visibility = decide(full, 'aide');
      const baseItem = {
        ...safeFull,
        provenance: buildProvenance({
          verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeFull.date_verification : null,
          fetchedAt: sourceDocument?.fetched_at || safeFull.fetched_at,
          sourceUrl: sourceDocument?.source_url || safeFull.source_url,
        }),
        contentStatus: visibility.contentStatus,
      };
      if (q) {
        return { ...baseItem, rank: raw.rank };
      }
      return baseItem;
    }).filter(Boolean);
  }

  const rawFacets = (facetsResult && facetsResult[0]) ? facetsResult[0] : {};

  return {
    items: enrichedItems,
    total: Number(countResult[0].total || 0),
    facets: {
      themes: rawFacets.themes || {},
      organismes: rawFacets.organismes || {},
      publics: rawFacets.publics || {},
      territoires: rawFacets.territoires || {}
    }
  };
}

/**
 * Builds and executes a search query for Demarches.
 */
/**
 * @param {any} db
 * @param {any} params
 */
export async function searchDemarches(params) {
  const {
    q,
    category,
    theme,
    situation,
    geo,
    territoire,
    territory,
    audience,
    online,
    statut = 'publie',
    statut_in,
    publicOnly = true,
    source,
    sort,
    page,
    pageSize,
    hideTestContent = false,
  } = params;

  const effectiveCategory = theme || category;
  const effectiveGeo = geo || territoire || territory;
  const LIMIT = Number(pageSize) || 20;
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;

  // Phase 3: support statut_in (array) for multi-value filtering
  const conditions = [];
  if (publicOnly !== false) {
    conditions.push(visibleSql('demarche'));   // D-5: published AND verified/current/eligible (statut_in is ignored for the public)
  } else if (statut_in && Array.isArray(statut_in) && statut_in.length > 0) {
    conditions.push(sql`statut = ANY(ARRAY[${sql.join(statut_in, sql.raw(', '))}]::text[])`);
  } else {
    conditions.push(sql`statut = ${statut}`);
  }

  const sv = q ? await hasSearchVector('Demarche') : false;
  if (q) {
    // ILIKE on titre + description; the full-text clause only when the column exists (hasSearchVector)
    conditions.push(sql`(
      ("titre" ILIKE ${'%' + q + '%'})
      OR ("description_courte" ILIKE ${'%' + q + '%'})
      ${svOr(sv, q)}
    )`);
  }

  if (effectiveCategory) {
    conditions.push(sql`("categoryId" = ${effectiveCategory} OR EXISTS (SELECT 1 FROM "AidCategory" c WHERE c.id = "Demarche"."categoryId" AND c.slug = ${effectiveCategory}))`);
  }

  if (situation) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM "_DemarcheToSituation" j
      JOIN "LifeSituation" s ON s.id = j."B"
      WHERE j."A" = "Demarche".id AND s.slug = ${situation}
    )`);
  }

  if (params.territoryFilter && params.territoryFilter.userTerritoryIds && params.territoryFilter.userTerritoryIds.length > 0) {
    const territoryIds = params.territoryFilter.userTerritoryIds;
    const valuesList = sql.join(territoryIds.map((/** @type {string | number | boolean | null | undefined} */ id, /** @type {string | number | boolean | null | undefined} */ idx) => sql`(${id}::text, ${idx}::int)`), sql`, `);
    conditions.push(sql`
      (
        NOT EXISTS (SELECT 1 FROM "Applicability" app WHERE app.entity_type = 'PROCEDURE' AND app.entity_id = "Demarche".id)
        OR (
          SELECT app.is_exclusion 
          FROM "Applicability" app
          JOIN (VALUES ${valuesList}) AS t(tid, depth) ON app.territory_id = t.tid
          WHERE app.entity_type = 'PROCEDURE' AND app.entity_id = "Demarche".id
          ORDER BY t.depth ASC, app.is_exclusion ASC
          LIMIT 1
        ) = false
      )
    `);
  } else if (effectiveGeo) {
    // Legacy fallback if no canonical territory context
    conditions.push(sql`${effectiveGeo} = ANY("departements")`);
  } else {
    // No context: Only National procedures (those without inclusions) remain discoverable.
    // Local procedures (those with inclusions) require a territory context.
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM "Applicability" app WHERE app.entity_type = 'PROCEDURE' AND app.entity_id = "Demarche".id AND app.is_exclusion = false)`);
  }

  if (audience) {
    conditions.push(sql`${audience} = ANY("audiences")`);
  }

  if (online === 'true' || online === '1') {
    conditions.push(sql`("lien_officiel" IS NOT NULL AND "lien_officiel" <> '')`);
  }

  if (hideTestContent) {
    conditions.push(sql`NOT ("titre" ILIKE 'Test%' OR "titre" ILIKE 'Démarche Test%' OR "titre" ILIKE 'Demarche Test%')`);
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}`
    : sql``;

  let orderBy;
  let selectRank = sql``;

  /** @type {Record<string, string>} */
  const sortAliases = {
    relevance: 'pertinence',
    recent: '-published_at',
    '-recent': 'published_at',
    quality: '-quality_score',
    '-quality': 'quality_score',
  };

  const effectiveSort = sortAliases[sort] || sort;
  const sortDirection = effectiveSort?.startsWith('-') ? 'DESC' : 'ASC';
  const sortField = effectiveSort?.startsWith('-') ? effectiveSort.substring(1) : effectiveSort;

  /** @type {Record<string, string>} */
  const SAFE_SORT_COLUMNS = {
    'date': 'published_at',
    'alpha': 'titre',
    'created_date': 'updatedAt',
    'updated_date': 'updatedAt',
    'published_at': 'published_at',
    'date_publication': 'published_at',
    'titre': 'titre',
    'quality_score': 'quality_score',
  };

  if (q && (effectiveSort === 'pertinence' || sortField === 'pertinence')) {
    // Use simple ordering by titre match when search_vector is missing
    selectRank = sql`, CASE WHEN "titre" ILIKE ${'%' + q + '%'} THEN 2 WHEN "description_courte" ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END as rank`;
    orderBy = sql`ORDER BY rank DESC, published_at DESC, id ASC`;
  } else if (sortField === 'pertinence') {
    // Relevance sorting requires q. Without q we fallback to date.
    orderBy = sql`ORDER BY published_at DESC, id ASC`;
  } else if (sortField && SAFE_SORT_COLUMNS[sortField]) {
    const dbColumn = SAFE_SORT_COLUMNS[sortField];
    const safeColumn = sql.raw(`"${dbColumn}"`);

    if (dbColumn === 'quality_score') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, published_at DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, published_at DESC, id ASC`;
    } else {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    }
  } else if (q) {
    selectRank = sql`, CASE WHEN "titre" ILIKE ${'%' + q + '%'} THEN 2 WHEN "description_courte" ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END as rank`;
    orderBy = sql`ORDER BY rank DESC, published_at DESC, id ASC`;
  } else {
    // Default without q: quality first, then recent.
    orderBy = sql`ORDER BY "quality_score" DESC, published_at DESC, id ASC`;
  }

  const itemsQuery = sql`SELECT id ${selectRank} FROM "Demarche" ${whereClause} ${orderBy} LIMIT ${LIMIT} OFFSET ${OFFSET}`;
  const countQuery = sql`SELECT count(*) as total FROM "Demarche" ${whereClause}`;

  const [itemsRes, countRes] = await Promise.all([
    db.execute(itemsQuery),
    db.execute(countQuery)
  ]);
  const items = itemsRes.rows || itemsRes;
  const countResult = countRes.rows || countRes;

  const itemIds = items.map((/** @type {{ id: string }} */ i) => i.id);
  let enrichedItems = [];
  if (itemIds.length > 0) {
    const fullItems = await db.query.Demarche.findMany({
      where: (demarche, { inArray }) => inArray(demarche.id, itemIds),
      columns: {
        id: true,
        slug: true,
        titre: true,
        categorie: true,
        description_courte: true,
        summary_falc: true,
        delai: true,
        lien_officiel: true,
        source_url: true,
        source_url_exact: true,
        date_verification: true,
        statut: true, launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true,
        quality_score: true,
        published_at: true,
        updatedAt: true,
      },
      with: {
        sourceDocument: {
          columns: {
            fetched_at: true,
            source_url: true,
          },
        },
        category: {
          columns: {
            id: true,
            slug: true,
            label: true,
          },
        },
      },
    });
    const itemMap = new Map(fullItems.map((/** @type {{ id: string }} */ i) => [i.id, i]));
    enrichedItems = items.map((/** @type {{ id: string, rank?: number }} */ raw) => {
      const full = itemMap.get(raw.id);
      if (!full) return null;
      const { sourceDocument, verified_by: _reviewer, publication_hold: _hold, ...safeFull } = full;
      const visibility = decide(full, 'demarche');
      const baseItem = {
        ...safeFull,
        provenance: buildProvenance({
          verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeFull.date_verification : null,
          fetchedAt: sourceDocument?.fetched_at,
          sourceUrl: sourceDocument?.source_url || safeFull.source_url || safeFull.source_url_exact,
        }),
        contentStatus: visibility.contentStatus,
      };
      if (q) return { ...baseItem, rank: raw.rank };
      return baseItem;
    }).filter(Boolean);
  }

  return {
    items: enrichedItems,
    total: Number(countResult[0].total || 0)
  };
}

/**
 * Builds and executes a search query for Structures.
 */
/**
 * @param {any} db
 * @param {any} params
 */
export async function searchStructures(params) {
  const { q, city, zip, type, departement, pmr, sort, page, pageSize, serves } = params;
  const LIMIT = Number(pageSize) || 20;
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;

  const conditions = [visibleSql('structure')];   // D-5: active AND verified/current/eligible
  // PKG-11 / E05: « serves this commune » = the commune is in the organization's service area (insee_codes), which reaches the record only through a reviewed
  // Espace Structure proposal, and a geography change accepted without the reviewer confirming the territory withdraws territory_verified — so every place that
  // stays visible here (D-5 requires territory_verified) has a REVIEWED area. Being located in a commune (city) is a different, weaker fact.
  if (serves) conditions.push(sql`${String(serves)} = ANY(coalesce("Structure"."insee_codes", ARRAY[]::text[]))`);

  const sv = q ? await hasSearchVector('Structure') : false;
  // PKG-11 / E04: what a structure DECLARES it does (catalogue `services`) and the services it offers for booking on ADA (active, published booking only) feed the
  // search — before, a search for « aide administrative » found only names and short descriptions. Shown as « why shown », never as a promise of suitability.
  const like = q ? '%' + q + '%' : null;
  const serviceMatch = q ? sql`(EXISTS (SELECT 1 FROM unnest(coalesce("Structure"."services", ARRAY[]::text[])) AS declared(x) WHERE declared.x ILIKE ${like})
      OR ("Structure"."is_pro_enabled" = true AND EXISTS (SELECT 1 FROM "ProRdvService" bookable WHERE bookable."structureId" = "Structure".id AND bookable."isActive" = true AND bookable.name ILIKE ${like})))` : null;
  if (q) {
    conditions.push(sql`(
      ("nom" ILIKE ${'%' + q + '%'}) OR ("description_courte" ILIKE ${'%' + q + '%'})
      ${svOr(sv, q)}
      OR ${serviceMatch}
    )`);
  }

  // Phase 9: StructureServiceArea Filtering (FR-010)
  if (params.territoryFilter && params.territoryFilter.userTerritoryIds && params.territoryFilter.userTerritoryIds.length > 0) {
    const territoryIds = params.territoryFilter.userTerritoryIds;
    const joinedIds = sql.join(territoryIds.map(id => sql`${id}`));
    conditions.push(sql`
      (
        NOT EXISTS (SELECT 1 FROM "StructureServiceArea" ssa WHERE ssa.structure_id = "Structure".id)
        OR EXISTS (
          SELECT 1 FROM "StructureServiceArea" ssa 
          WHERE ssa.structure_id = "Structure".id 
            AND (ssa.service_type = 'NATIONAL' OR ssa.territory_id IN (${joinedIds}))
        )
      )
    `);
  } else {
    // Phase 9 semantics: If no context, restrict to NATIONAL or missing service areas (prevent local leakage)
    conditions.push(sql`
      (
        NOT EXISTS (SELECT 1 FROM "StructureServiceArea" ssa WHERE ssa.structure_id = "Structure".id)
        OR EXISTS (
          SELECT 1 FROM "StructureServiceArea" ssa 
          WHERE ssa.structure_id = "Structure".id 
            AND ssa.service_type = 'NATIONAL'
        )
      )
    `);
    // Legacy fallback
    if (city) conditions.push(sql`"ville" ILIKE ${'%' + city + '%'}`);
    if (zip) conditions.push(sql`"code_postal" = ${zip}`);
    if (departement) conditions.push(sql`"departement" = ${departement}`);
  }

  if (type && type !== '_all') {
    // Handle legacy values like "Association" vs "association"
    conditions.push(sql`LOWER("type_structure") = LOWER(${type})`);
  }

  const wantsPmr = pmr === 'true' || pmr === '1';
  if (wantsPmr) {
    conditions.push(sql`"accessibilite_pmr" = true`);
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}`
    : sql``;

  let orderBy;
  let selectRank = sql``;

  // P4: external sort aliases (stable contract) -> internal implementation
  /** @type {Record<string, string>} */
  const sortAliases = {
    relevance: 'pertinence',
    recent: '-updated_date',
    '-recent': 'updated_date',
    quality: '-quality_score',
    '-quality': 'quality_score',
    alpha: 'nom',
    '-alpha': '-nom',
  };

  const effectiveSort = sortAliases[sort] || sort;
  const sortDirection = effectiveSort?.startsWith('-') ? 'DESC' : 'ASC';
  const sortField = effectiveSort?.startsWith('-') ? effectiveSort.substring(1) : effectiveSort;

  /** @type {Record<string, string>} */
  const SAFE_SORT_COLUMNS = {
    updated_date: 'updatedAt',
    nom: 'nom',
    quality_score: 'quality_score',
  };

  if (q && (effectiveSort === 'pertinence' || sortField === 'pertinence')) {
    selectRank = sql`, CASE WHEN ${svFlag(sv)} THEN ${svRank(sv, q)} ELSE CASE WHEN "nom" ILIKE ${'%' + q + '%'} THEN 2 WHEN "description_courte" ILIKE ${'%' + q + '%'} THEN 1 WHEN ${serviceMatch} THEN 1 ELSE 0 END END as rank`;
    orderBy = sql`ORDER BY rank DESC, quality_score DESC, nom ASC, id ASC`;
  } else if (sortField === 'pertinence') {
    // Relevance sorting requires q. Without q we fallback to quality.
    orderBy = sql`ORDER BY quality_score DESC, "updatedAt" DESC, id ASC`;
  } else if (sortField && SAFE_SORT_COLUMNS[sortField]) {
    const dbColumn = SAFE_SORT_COLUMNS[sortField];
    const safeColumn = sql.raw(`"${dbColumn}"`);

    if (dbColumn === 'quality_score') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, "updatedAt" DESC, nom ASC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, "updatedAt" DESC, nom ASC, id ASC`;
    } else if (dbColumn === 'updatedAt') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    } else {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    }
  } else {
    // Default fallback (stable & useful): quality first, then most recent
    orderBy = sql`ORDER BY quality_score DESC, "updatedAt" DESC, id ASC`;
  }

  const itemsQuery = sql`SELECT id ${selectRank} FROM "Structure" ${whereClause} ${orderBy} LIMIT ${LIMIT} OFFSET ${OFFSET}`;
  const countQuery = sql`SELECT count(*) as total FROM "Structure" ${whereClause}`;

  const [itemsRes, countRes] = await Promise.all([
    db.execute(itemsQuery),
    db.execute(countQuery)
  ]);
  const items = itemsRes.rows || itemsRes;
  const countResult = countRes.rows || countRes;

  const itemIds = items.map((/** @type {{ id: string }} */ i) => i.id);
  let enrichedItems = [];
  if (itemIds.length > 0) {
    const fullItems = await db.query.Structure.findMany({
      where: (structure, { inArray }) => inArray(structure.id, itemIds),
      columns: {
        id: true,
        slug: true,
        nom: true,
        type_structure: true,
        accessibilite_pmr: true,
        description_courte: true,
        date_verification: true,
        launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true,
        source_url: true,
        source_url_exact: true,
        adresse: true,
        code_postal: true,
        ville: true,
        departement: true,
        latitude: true,
        longitude: true,
        telephone: true,
        email: true,
        site_web: true,
        horaires: true,
        updatedAt: true,
        published_at: true,
        quality_score: true,
        statut: true,
        status: true,
        is_pro_enabled: true,
        services: true,
      },
      with: {
        sourceDocument: {
          columns: {
            fetched_at: true,
            source_url: true,
          },
        },
      },
    });
    const itemMap = new Map(fullItems.map((/** @type {{ id: string }} */ i) => [i.id, i]));
    // E04 « why shown »: the declared or bookable services that match the words searched (max 3 per structure; text as the structure wrote it)
    /** @type {Map<string, string[]>} */
    const whyShown = new Map();
    if (q) {
      const needle = String(q).toLowerCase();
      for (const f of fullItems) {
        const declared = (Array.isArray(f.services) ? f.services : []).filter((/** @type {unknown} */ x) => typeof x === 'string' && x.toLowerCase().includes(needle));
        if (declared.length) whyShown.set(f.id, declared.slice(0, 3));
      }
      const bookable = (await db.execute(sql`SELECT b."structureId" AS sid, b.name FROM "ProRdvService" b JOIN "Structure" s ON s.id = b."structureId"
        WHERE b."structureId" IN (${sql.join(itemIds.map((/** @type {string} */ i) => sql`${i}`), sql`, `)}) AND b."isActive" = true AND s."is_pro_enabled" = true AND b.name ILIKE ${like}
        ORDER BY b.name`)).rows || [];
      for (const r of bookable) {
        const list = whyShown.get(String(r.sid)) || [];
        if (list.length < 3 && !list.includes(String(r.name))) whyShown.set(String(r.sid), [...list, String(r.name)]);
      }
    }
    enrichedItems = items.map((/** @type {{ id: string, rank?: number }} */ raw) => {
      const full = itemMap.get(raw.id);
      if (!full) return null;
      const { sourceDocument, verified_by: _reviewer, publication_hold: _hold, ...safeFull } = full;
      const visibility = decide(full, 'structure');
      const baseItem = {
        ...safeFull,
        provenance: buildProvenance({
          verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeFull.date_verification : null,
          fetchedAt: sourceDocument?.fetched_at,
          sourceUrl: sourceDocument?.source_url || safeFull.source_url || safeFull.source_url_exact,
        }),
        contentStatus: visibility.contentStatus,
      };
      if (q) return { ...baseItem, rank: raw.rank, ...(whyShown.has(raw.id) ? { whyShown: { services: whyShown.get(raw.id) } } : {}) };
      return baseItem;
    }).filter(Boolean);
  }

  return {
    items: enrichedItems,
    total: Number(countResult[0].total || 0)
  };
}
