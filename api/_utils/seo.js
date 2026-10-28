// @ts-nocheck
export const PRODUCTION_DOMAIN = 'www.accesdirectaide.fr';

/**
 * Determines the canonical base URL for the application.
 * Ensures that sitemaps and other SEO-critical elements always point to the production domain,
 * unless explicitly configured otherwise.
 *

 * @param {Object} req - The request object (standard Node/Vercel req)
 * @returns {string} - The canonical base URL (e.g., 'https://www.accesdirectaide.fr')
 */
export function getCanonicalBaseUrl(req) {
    // @ts-ignore
    const host = req.headers['x-forwarded-host'] || req.headers.host;

    // If the host is the production domain, use it.
    if (host === PRODUCTION_DOMAIN) {
        return `https://${PRODUCTION_DOMAIN}`;
    }

    // If we have a custom domain that is NOT vercel.app, we might consider it valid (e.g. staging),
    // but for "Anti-error" robustness, we default to the known production domain

    // to prevent accidental indexing of staging/preview URLs in sitemaps.
    // This fulfills: "robots.txt doit pointer vers le sitemap du domaine canonique"

    return `https://${PRODUCTION_DOMAIN}`;
}

/**
 * Determines if the current request context should be indexed by search engines.
 *

 * @param {Object} req - The request object
 * @returns {boolean} - True if indexable (Prod), False otherwise (Staging, Vercel, etc.)
 */
export function isIndexable(req) {
    // @ts-ignore
    const host = req.headers['x-forwarded-host'] || req.headers.host;

    if (!host) return false;

    // Strict check: Only www.accesdirectaide.fr is indexable
    // This prevents *.vercel.app and any other aliases from being indexed.
    return host === PRODUCTION_DOMAIN;
}
