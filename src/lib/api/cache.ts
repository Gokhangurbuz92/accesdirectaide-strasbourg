/**
 * In-memory TTL cache for API responses.
 *
 * - Simple Map-based store with expiry timestamps
 * - No external dependencies, no localStorage
 * - Thread-safe within a single JS context (browser tab)
 *
 * Policy:
 *   LISTING_TTL_MS = 60 s   (list changes frequently with filters)
 *   DETAIL_TTL_MS  = 5 min  (detail content is more stable)
 */

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

export const LISTING_TTL_MS = 60_000;       // 1 minute
export const DETAIL_TTL_MS = 5 * 60_000;    // 5 minutes

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

const store = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a cached value if it exists and has not expired.
 * Returns `null` on miss or expiry (expired entries are cleaned up lazily).
 */
export function getCache<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }

    return entry.value as T;
}

/**
 * Store a value with a TTL in milliseconds.
 */
export function setCache<T>(key: string, value: T, ttlMs: number): void {
    store.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

/**
 * Clear cache entries.
 * - No argument: clear all entries.
 * - With prefix: clear only entries whose key starts with the prefix.
 */
export function clearCache(prefix?: string): void {
    if (!prefix) {
        store.clear();
        return;
    }

    const keys = Array.from(store.keys());
    for (const key of keys) {
        if (key.startsWith(prefix)) {
            store.delete(key);
        }
    }
}

// ---------------------------------------------------------------------------
// Key builder — stable, sorted query string for cache key generation
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cache key from a path and params.
 * Params are sorted alphabetically to ensure identical requests
 * produce the same key regardless of property order.
 */
export function buildCacheKey(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>,
): string {
    if (!params) return path;

    const sorted = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("&");

    return sorted ? `${path}?${sorted}` : path;
}
