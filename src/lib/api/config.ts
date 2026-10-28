/**
 * API configuration.
 *
 * The app and the API share the same origin on Vercel (rewrite rule in
 * vercel.json). In dev you may point to a remote API by setting
 * VITE_API_BASE_URL in .env.local.
 *
 * Default: "" (same-origin, relative URLs like /api/aides).
 */

export function getApiBaseUrl(): string {
    const value = import.meta.env.VITE_API_BASE_URL;

    if (value === undefined || value === null || value === "") {
        // Same-origin — the default and most common case.
        return "";
    }

    // Strip trailing slash for consistent URL building.
    return value.replace(/\/+$/, "");
}

/** Default request timeout in milliseconds. */
export const API_TIMEOUT_MS = 10_000;
