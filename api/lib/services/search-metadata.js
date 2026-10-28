// @ts-nocheck
/**
 * Phase 8 Search Metadata Extension.
 * Extends indexed metadata with provenance, territory, authority, freshness.
 * Works alongside existing pgvector/FTS/RRF search stack.
 */

/**
 * Build extended metadata object for search indexing.
 * These fields supplement the existing embedding/FTS index.
 */
export function buildSearchMetadata(/** @type {Record<string, unknown>} */ {
  sourceId,
  documentId,
  section,
  territory,
  authority,
  capabilities = [],
  effectiveDate,
  sourceUpdatedAt,
  retrievedAt,
  freshnessState,
  contentHash,
  version,
  url,
  language = 'fr'
}) {
  return {
    sourceId,
    documentId,
    section: section || null,
    territory: territory || null,
    authority: authority || null,
    capabilities,
    effectiveDate: effectiveDate || null,
    sourceUpdatedAt: sourceUpdatedAt || null,
    retrievedAt: retrievedAt || new Date().toISOString(),
    freshnessState: freshnessState || 'UNKNOWN',
    contentHash: contentHash || null,
    version: version || null,
    url: url || null,
    language
  };
}

/**
* Filter search results by territory relevance.
* A result matches if:
* - result has no territory (national/universal)
* - result territory matches query territory
* - result territory is a parent of query territory
* @param {any[]} results
*/
export function filterByTerritory(results, /** @type {string} */ queryTerritory) {
  if (!queryTerritory) return results;
  return results.filter(r => {
    if (!r.territory) return true; // National/universal
    return r.territory === queryTerritory || queryTerritory.startsWith(r.territory);
  });
}

/**
 * Score freshness for ranking adjustment.
 * FRESH sources get no penalty, STALE sources get down-ranked.
 */
export function freshnessRankAdjustment(freshnessState) {
  const adjustments = {
    FRESH: 0,
    AGING: -0.05,
    STALE: -0.15,
    EXPIRED: -0.3,
    BROKEN: -0.5,
    UNKNOWN: -0.1
  };
  // @ts-ignore
  return adjustments[freshnessState] !== undefined ? adjustments[freshnessState] : -0.1;
}
