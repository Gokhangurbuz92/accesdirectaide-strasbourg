/**
 * Typed endpoint wrappers for the Aides API.
 *
 * Routes confirmed in:
 *   - api/routes.js           → { path: 'aides', match: 'prefix' }
 *   - api/_handlers/aides.js  → GET list (query params) + GET by slug (path param)
 *   - api/lib/search-query.js → enrichment + pagination shape
 *
 * V2-04: Added cache-aware fetching with TTL + inflight deduplication.
 */

import { apiGetDeduped } from "./client";
import { getCache, setCache, clearCache, buildCacheKey, LISTING_TTL_MS, DETAIL_TTL_MS } from "./cache";
import type { ApiAidesListResponse, ApiAideDetail } from "@/types/api";

// ---------------------------------------------------------------------------
// Search / list params (mirrors backend searchAidesSchema)
// ---------------------------------------------------------------------------

export interface ListAidesParams {
    q?: string;
    theme?: string;
    sousTheme?: string;
    /** "public" alias — audience filter */
    public?: string;
    territoire?: string;
    situation?: string;
    organisme?: string;
    urgent?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
}

// ---------------------------------------------------------------------------
// Internal: build query record from params
// ---------------------------------------------------------------------------

function buildListQuery(
    params?: ListAidesParams,
): Record<string, string | number | boolean | undefined | null> {
    const query: Record<string, string | number | boolean | undefined | null> = {};
    if (!params) return query;

    if (params.q) query.q = params.q;
    if (params.theme) query.theme = params.theme;
    if (params.sousTheme) query.sousTheme = params.sousTheme;
    if (params.public) query.public = params.public;
    if (params.territoire) query.territoire = params.territoire;
    if (params.situation) query.situation = params.situation;
    if (params.organisme) query.organisme = params.organisme;
    if (params.urgent) query.urgent = params.urgent;
    if (params.sort) query.sort = params.sort;
    if (params.page != null) query.page = params.page;
    if (params.pageSize != null) query.pageSize = params.pageSize;

    return query;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const LIST_PATH = "/api/aides";

/**
 * Search / list Aides (cache-aware).
 *
 * GET /api/aides?q=…&theme=…&page=…&pageSize=…&sort=…
 *
 * @param params  - Filter/search parameters
 * @param options - `{ skipCache: true }` to bypass cache (used by refetch)
 */
export function listAides(
    params?: ListAidesParams,
    options?: { skipCache?: boolean },
): Promise<ApiAidesListResponse> {
    const query = buildListQuery(params);
    const key = buildCacheKey(LIST_PATH, query);

    // Cache hit?
    if (!options?.skipCache) {
        const cached = getCache<ApiAidesListResponse>(key);
        if (cached) return Promise.resolve(cached);
    }

    // Fetch (deduplicated) and cache result.
    return apiGetDeduped<ApiAidesListResponse>(key, LIST_PATH, query).then(
        (data) => {
            setCache(key, data, LISTING_TTL_MS);
            return data;
        },
    );
}

/**
 * Invalidate listing cache (all entries).
 */
export function invalidateListAidesCache(): void {
    clearCache(LIST_PATH);
}

/**
 * Get a single Aide by slug (cache-aware).
 *
 * GET /api/aides/:slug
 *
 * @param slug    - URL slug
 * @param options - `{ skipCache: true }` to bypass cache (used by refetch)
 */
export function getAideBySlug(
    slug: string,
    options?: { skipCache?: boolean },
): Promise<ApiAideDetail> {
    const path = `/api/aides/${encodeURIComponent(slug)}`;
    const key = buildCacheKey(path);

    if (!options?.skipCache) {
        const cached = getCache<ApiAideDetail>(key);
        if (cached) return Promise.resolve(cached);
    }

    return apiGetDeduped<ApiAideDetail>(key, path).then((data) => {
        setCache(key, data, DETAIL_TTL_MS);
        return data;
    });
}
