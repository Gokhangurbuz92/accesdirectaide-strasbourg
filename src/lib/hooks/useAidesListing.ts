/**
 * useAidesListing — source of truth for the Aides listing page.
 *
 * Uses V2-01 client layer (listAides + mapAideToCard).
 * V2-04: Cache-aware — instant display from cache, refetch bypasses cache.
 *
 * State machine: idle → loading → success | error
 * Debounce: 250ms on query text changes.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listAides, invalidateListAidesCache } from "@/lib/api/endpoints";
import { mapAideToCard } from "@/lib/api/mappers";
import type { AidCardViewModel } from "@/lib/api/mappers";
import type { ListAidesParams } from "@/lib/api/endpoints";
import type { ApiPagination, ApiFacets } from "@/types/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListingStatus = "idle" | "loading" | "success" | "error";

export interface AidesListingFilters {
    q: string;
    theme: string;
    urgent: boolean;
    sort: string;
    page: number;
    pageSize: number;
    /** Additional URL params forwarded as-is */
    situation?: string;
    territoire?: string;
}

export interface AidesListingResult {
    status: ListingStatus;
    items: AidCardViewModel[];
    pagination: ApiPagination | null;
    facets: ApiFacets | null;
    errorMessage?: string;
    refetch: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 250;

const EMPTY_PAGINATION: ApiPagination = {
    total: 0,
    page: 1,
    limit: 20,
    pageSize: 20,
    totalPages: 1,
    hasNext: false,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAidesListing(filters: AidesListingFilters): AidesListingResult {
    const [status, setStatus] = useState<ListingStatus>("idle");
    const [items, setItems] = useState<AidCardViewModel[]>([]);
    const [pagination, setPagination] = useState<ApiPagination | null>(null);
    const [facets, setFacets] = useState<ApiFacets | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | undefined>();

    // Abort in-flight requests on unmount or new request.
    const abortRef = useRef<AbortController | null>(null);
    // Track current fetch version to ignore stale responses.
    const versionRef = useRef(0);

    const doFetch = useCallback(async (f: AidesListingFilters, skipCache = false) => {
        // Cancel previous in-flight request.
        if (abortRef.current) {
            abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;

        const version = ++versionRef.current;

        // Only show loading if we don't already have data (avoid flash on cache hit).
        if (items.length === 0 || skipCache) {
            setStatus("loading");
        }
        setErrorMessage(undefined);

        const params: ListAidesParams = {
            page: f.page,
            pageSize: f.pageSize,
            sort: f.sort || undefined,
        };
        if (f.q.trim()) params.q = f.q.trim();
        if (f.theme) params.theme = f.theme;
        if (f.urgent) params.urgent = "true";
        if (f.situation) params.situation = f.situation;
        if (f.territoire) params.territoire = f.territoire;

        try {
            const response = await listAides(params, { skipCache });

            // Ignore stale response.
            if (version !== versionRef.current) return;

            const mapped = response.items.map(mapAideToCard);
            setItems(mapped);
            setPagination(response.pagination ?? EMPTY_PAGINATION);
            setFacets(response.facets ?? null);
            setStatus("success");
        } catch (err: unknown) {
            // Ignore aborted requests.
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (version !== versionRef.current) return;

            setItems([]);
            setPagination(null);
            setFacets(null);
            setErrorMessage("Impossible de charger les aides. Réessayez.");
            setStatus("error");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Trigger fetch with debounce on `q`, immediate for other changes.
    useEffect(() => {
        // Debounce only when query text changes.
        const delay = filters.q.trim() ? DEBOUNCE_MS : 0;
        const timer = setTimeout(() => {
            doFetch(filters);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        filters.q,
        filters.theme,
        filters.urgent,
        filters.sort,
        filters.page,
        filters.pageSize,
        filters.situation,
        filters.territoire,
        doFetch,
    ]);

    // Cleanup on unmount.
    useEffect(() => {
        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    // Refetch: invalidate cache then re-fetch.
    const refetch = useCallback(() => {
        invalidateListAidesCache();
        doFetch(filters, true);
    }, [doFetch, filters]);

    return { status, items, pagination, facets, errorMessage, refetch };
}
