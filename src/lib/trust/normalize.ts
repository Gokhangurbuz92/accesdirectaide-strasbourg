/**
 * Data normalization utilities for dates, URLs, and provenance.
 *
 * All functions are pure, side-effect-free, and return null for invalid input.
 * They enforce the trust policy: no "Non renseigné", no future dates,
 * no invalid URLs, no empty strings masquerading as data.
 */

import { MAX_FUTURE_SKEW_MS } from "./policy";
import type { ApiProvenance } from "@/types/api";

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Safely parse a date input into a Date object.
 *
 * Accepts:
 *   - ISO 8601 string (e.g. "2026-01-15T10:00:00Z")
 *   - dd/mm/yyyy string (European format, commonly found in French data)
 *   - Date object
 *   - null / undefined / empty string → null
 *
 * Returns null if the input cannot be parsed into a valid date.
 */
export function parseDateSafe(input: string | Date | null | undefined): Date | null {
    if (input == null) return null;

    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }

    const trimmed = String(input).trim();
    if (!trimmed) return null;

    // Try dd/mm/yyyy format first (French locale)
    const ddmmyyyy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`);
        return isNaN(d.getTime()) ? null : d;
    }

    // Try ISO / standard JS parsing
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Future-date clamping
// ---------------------------------------------------------------------------

/**
 * Reject dates that are too far in the future.
 *
 * If a date is more than `maxSkewMs` ahead of `now`, it is considered
 * invalid data (clock error, bad import) and returned as null.
 *
 * @param date       - The date to check
 * @param now        - Reference "now" timestamp (default: Date.now())
 * @param maxSkewMs  - Maximum allowed future offset in ms (default: policy constant)
 * @returns The original date if valid, or null if it's too far in the future
 */
export function clampFutureDate(
    date: Date | null,
    now: number = Date.now(),
    maxSkewMs: number = MAX_FUTURE_SKEW_MS,
): Date | null {
    if (!date) return null;
    if (date.getTime() > now + maxSkewMs) return null;
    return date;
}

// ---------------------------------------------------------------------------
// String normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a source label: trim and return null if empty.
 */
export function normalizeSourceLabel(label: string | null | undefined): string | null {
    if (label == null) return null;
    const trimmed = String(label).trim();
    return trimmed || null;
}

/**
 * Normalize a URL: validate it's http/https and return null if invalid.
 */
export function normalizeUrl(url: string | null | undefined): string | null {
    if (url == null) return null;
    const trimmed = String(url).trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return trimmed;
        }
        return null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Provenance builder
// ---------------------------------------------------------------------------

export interface NormalizedProvenance {
    verifiedAt: string | null;    // ISO string or null
    collectedAt: string | null;   // ISO string or null
    sourceLabel: string | null;
    sourceUrl: string | null;
}

/**
 * Build a normalized provenance object from raw API data.
 *
 * Applies all trust rules:
 *   - Dates are parsed and future-clamped
 *   - Source label is trimmed (null if empty)
 *   - Source URL must be valid http/https (null otherwise)
 *   - No fallback strings — null means "no data"
 *
 * @param provenance   - API provenance object
 * @param dateVerif    - Fallback date_verification from root aide object
 * @param now          - Reference timestamp for future-date check
 */
export function buildProvenance(
    provenance: ApiProvenance | null | undefined,
    dateVerif: string | null | undefined,
    now: number = Date.now(),
): NormalizedProvenance {
    // Parse and clamp verifiedAt
    const rawVerified = provenance?.verifiedAt ?? dateVerif ?? null;
    const parsedVerified = clampFutureDate(parseDateSafe(rawVerified), now);

    // Parse and clamp collectedAt (fetchedAt from provenance)
    const rawCollected = provenance?.fetchedAt ?? null;
    const parsedCollected = clampFutureDate(parseDateSafe(rawCollected), now);

    return {
        verifiedAt: parsedVerified ? parsedVerified.toISOString() : null,
        collectedAt: parsedCollected ? parsedCollected.toISOString() : null,
        sourceLabel: normalizeSourceLabel(provenance?.sourceHost),
        sourceUrl: normalizeUrl(provenance?.sourceUrl),
    };
}
