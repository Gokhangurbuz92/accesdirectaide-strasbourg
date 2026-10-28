// @ts-nocheck
import { applyNoStore, applyPublicCache, getHeader, hasAuthHeader, setCachePolicyTag } from "./cache.js";

/**
* @param {{ url: any; }} req
*/
function parseUrl(req) {
    // req.url might be "/api/aides?slug=..."
    try {
        return new URL(req.url || "", "http://localhost");
    } catch {
        return new URL("http://localhost/");
    }
}

/**
 * @param {string} pathname
 */
function isPrivatePath(pathname) {
    // Hard NO-STORE zones
    if (/^\/api\/(admin|auth|pro|rdv|messages|cron|health|monitor)\b/i.test(pathname)) return true;
    if (/^\/api\/public\/(messages|appointments|suggest-structure)\b/i.test(pathname)) return true;
    if (/^\/api\/(upload|download)\b/i.test(pathname)) return true;
    return false;
}

/**
 * @param {string} pathname
 */
function isVariesByUserPublicUnsafe(pathname) {
    // Keep endpoints with user/admin variants hard no-store unless explicitly whitelisted.
    return pathname === "/api/guides" || pathname === "/api/tools";
}

function isVercelDefaultCacheControl(/** @type {string | number | boolean | null | undefined} */ v) {
    const s = String(v || "").toLowerCase();
    // Vercel runtime default we want to override:
    // "public, max-age=0, must-revalidate"
    return (
        s.includes("public") &&
        s.includes("max-age=0") &&
        s.includes("must-revalidate") &&
        !s.includes("s-maxage") &&
        !s.includes("stale-while-revalidate") &&
        !s.includes("no-store")
    );
}

// @ts-ignore
export function applyCachePolicy(req, res) {
    // If handler already set Cache-Control, respectfully bail...
    // UNLESS it's the Vercel default "public, max-age=0, must-revalidate" which kills CDN caching.
    const existing = getHeader(res, "Cache-Control");
    if (existing && !isVercelDefaultCacheControl(existing)) return;

    const method = (req.method || "GET").toUpperCase();
    const url = parseUrl(req);
    const pathname = url.pathname;

    // Default: no-store for non-GET
    if (method !== "GET") {
        setCachePolicyTag(res, "NOSTORE_METHOD");
        return applyNoStore(res);
    }

    // Any Authorization => no-store (prevents leaking admin views / user-variant mixing)
    if (hasAuthHeader(req)) {
        setCachePolicyTag(res, "NOSTORE_AUTH");
        return applyNoStore(res);
    }

    // Private zones => no-store
    if (isPrivatePath(pathname)) {
        setCachePolicyTag(res, "NOSTORE_PRIVATE");
        return applyNoStore(res);
    }

    // Varies-by-user public endpoints => no-store (safe default)
    if (isVariesByUserPublicUnsafe(pathname)) {
        setCachePolicyTag(res, "NOSTORE_VARIES");
        return applyNoStore(res);
    }

    // === PUBLIC CACHE WHITELIST ===
    // robots/sitemap (very stable)
    if (pathname === "/api/robots.txt" || pathname === "/robots.txt") {
        setCachePolicyTag(res, "ROBOTS_1D");
        return applyPublicCache(res, { sMaxAge: 86400, swr: 604800 });
    }
    if (pathname === "/api/sitemap.xml" || pathname === "/sitemap.xml") {
        setCachePolicyTag(res, "SITEMAP_1H");
        return applyPublicCache(res, { sMaxAge: 3600, swr: 86400 });
    }

    // taxonomy (stable)
    if (pathname === "/api/taxonomy") {
        setCachePolicyTag(res, "TAXONOMY_1H");
        return applyPublicCache(res, { sMaxAge: 3600, swr: 86400 });
    }

    // public stats (already configured in your code, but safe to unify here)
    if (pathname === "/api/public/stats") {
        setCachePolicyTag(res, "STATS_5M");
        return applyPublicCache(res, { sMaxAge: 300, swr: 3600 });
    }

    // availability (volatile)
    if (pathname === "/api/public/availability") {
        setCachePolicyTag(res, "AVAIL_1M");
        return applyPublicCache(res, { sMaxAge: 60, swr: 120 });
    }

    // Public content (listing + detail)
    // P8-A contract:
    // - aides/demarches/structures: 1h + 24h SWR
    // - actualites: 5m + 6h SWR
    // PKG-11 audit: ONE record (path /api/structures/<slug> or ?slug= / ?id=) changes visibility with a hold or a verification decision — which only clears
    // the search cache — so a single record is cached 60 s, not 1 h + 24 h (a held address or phone stayed online that long). Lists keep the P8-A contract.
    if (/^\/api\/(aides|demarches|structures)(?:\/[^/]+)?$/i.test(pathname)
        && (/^\/api\/(aides|demarches|structures)\/[^/]+$/i.test(pathname) || url.searchParams.get("slug") || url.searchParams.get("id"))) {
        setCachePolicyTag(res, "PUBLIC_RECORD_1M");
        return applyPublicCache(res, { sMaxAge: 60, swr: 60 });
    }
    if (/^\/api\/(aides|demarches|structures)(?:\/[^/]+)?$/i.test(pathname)) {
        setCachePolicyTag(res, "PUBLIC_CONTENT_1H");
        return applyPublicCache(res, { sMaxAge: 3600, swr: 86400 });
    }

    if (/^\/api\/actualites(?:\/[^/]+)?$/i.test(pathname)) {
        setCachePolicyTag(res, "ACTUALITES_5M");
        return applyPublicCache(res, { sMaxAge: 300, swr: 21600 });
    }

    // Not in whitelist => default no-store (safe)
    setCachePolicyTag(res, "NOSTORE_DEFAULT");
    return applyNoStore(res);
}
