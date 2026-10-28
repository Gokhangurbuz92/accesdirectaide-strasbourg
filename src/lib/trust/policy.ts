/**
 * Trust policy — single source of truth for "missing data" display rules.
 *
 * These constants are consumed by:
 *   - normalize.ts (data sanitization)
 *   - mappers.ts  (view-model construction)
 *   - UI components read verifiedAt: if null → they hide the element
 *
 * Rule: the data layer NEVER fabricates "Non renseigné".
 * Rule: the data layer returns null when data is missing or invalid.
 * The UI hides nulls entirely (no placeholder labels).
 */

export const TRUST_POLICY = {
    /**
     * How to handle a missing verifiedAt date in the UI layer.
     * - "hide": hide the element entirely (default — no placeholder)
     */
    missingDateBehavior: "hide" as const,

    /**
     * Maximum allowed future skew in days.
     * Dates more than this far in the future are treated as invalid (→ null).
     * Tolerance covers timezone differences and minor clock skew.
     */
    maxFutureSkewDays: 2,
} as const;

/** Milliseconds equivalent of maxFutureSkewDays. */
export const MAX_FUTURE_SKEW_MS = TRUST_POLICY.maxFutureSkewDays * 24 * 60 * 60 * 1000;
