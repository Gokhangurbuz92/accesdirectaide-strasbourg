/**
 * useAideDetail — source of truth for the Aide detail page.
 *
 * Uses V2-01 client layer (getAideBySlug + mapAideToDetail).
 * V2-04: Cache-aware — instant display from cache, refetch bypasses cache.
 *
 * State machine: loading → success | error | not_found
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getAideBySlug } from "@/lib/api/endpoints";
import { mapAideToDetail } from "@/lib/api/mappers";
import type { AidDetailViewModel } from "@/lib/api/mappers";
import type { ApiError, ApiAideDetail } from "@/types/api";
import { clearCache } from "@/lib/api/cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetailStatus = "loading" | "success" | "error" | "not_found" | "gone";

export interface AideDetailResult {
    status: DetailStatus;
    /** Mapped view-model (only set when status === "success") */
    data?: AidDetailViewModel;
    /** Raw API response (only set when status === "success") — for fields not
     *  in the view-model (category, territoires, FALC, etapes, structures...) */
    raw?: ApiAideDetail;
    errorMessage?: string;
    refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAideDetail(slug: string | null | undefined): AideDetailResult {
    const [status, setStatus] = useState<DetailStatus>("loading");
    const [data, setData] = useState<AidDetailViewModel | undefined>();
    const [raw, setRaw] = useState<ApiAideDetail | undefined>();
    const [errorMessage, setErrorMessage] = useState<string | undefined>();

    const abortRef = useRef<AbortController | null>(null);
    const versionRef = useRef(0);

    const doFetch = useCallback(async (s: string, skipCache = false) => {
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const version = ++versionRef.current;

        // Only show loading if we don't already have data (avoid flash on cache hit).
        if (!data || skipCache) {
            setStatus("loading");
        }
        setErrorMessage(undefined);

        try {
            const response = await getAideBySlug(s, { skipCache });

            if (version !== versionRef.current) return;

            const mapped = mapAideToDetail(response);
            setData(mapped);
            setRaw(response);
            setStatus("success");
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (version !== versionRef.current) return;

            // Check for 404 → not_found
            const apiErr = err as ApiError;
            if (apiErr?.status === 404) {
                setData(undefined);
                setRaw(undefined);
                setStatus("not_found");
                return;
            }
            if (apiErr?.status === 410) {
                setData(undefined);
                setRaw(undefined);
                setStatus("gone");
                return;
            }

            setData(undefined);
            setRaw(undefined);
            setErrorMessage("Impossible de charger cette aide. Vérifiez votre connexion et réessayez.");
            setStatus("error");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!slug) {
            setStatus("not_found");
            setData(undefined);
            setRaw(undefined);
            return;
        }

        doFetch(slug);

        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, [slug, doFetch]);

    // Refetch: invalidate cache for this slug then re-fetch.
    const refetch = useCallback(() => {
        if (slug) {
            clearCache(`/api/aides/${encodeURIComponent(slug)}`);
            doFetch(slug, true);
        }
    }, [slug, doFetch]);

    return { status, data, raw, errorMessage, refetch };
}
