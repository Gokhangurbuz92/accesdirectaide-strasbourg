/**
 * Centralised "missing data" policy for trust surface.
 * SSOT: never show "Non renseigné".
 *
 * Default policy: "hide" — if a date is missing, the UI hides the element.
 */

export type MissingDatePolicy = "label" | "hide";

export interface TrustDisplayPolicy {
    /** How to handle missing dates: "hide" omits the element entirely (default) */
    missingDate: MissingDatePolicy;
}

export const DEFAULT_TRUST_POLICY: TrustDisplayPolicy = {
    missingDate: "hide",
};

/**
 * Returns a formatted date string or null when the line should be hidden.
 * Default policy: "hide" — no placeholder label is shown.
 */
export function resolveDateDisplay(
    date: Date | string | null | undefined,
    policy: MissingDatePolicy = "hide",
): string | null {
    if (!date) {
        return null;
    }

    const parsed = typeof date === "string" ? new Date(date) : date;

    if (isNaN(parsed.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(parsed);
}
