/**
 * @ada/shared/cache — CacheService
 *
 * Provides a `getOrSet(key, fetchFn, ttl)` pattern for caching expensive
 * operations (embeddings, OpenFisca calculations, Gemini responses).
 *
 * Backends (auto-detected):
 *   1. Upstash REST — production (uses same KV_REST_API creds as rate limiter)
 *   2. In-Memory Map — dev/fallback (with TTL expiry)
 *
 * Usage:
 *   import { cache } from '@ada/shared/cache';
 *   const result = await cache.getOrSet('openfisca:rsa:hash123', () => calculate(situation), 3600);
 */

// ─────────────────────────────────────────────────
// Backend detection
// ─────────────────────────────────────────────────

const KV_REST_URL = process.env.KV_REST_API_URL;
const KV_REST_TOKEN = process.env.KV_REST_API_TOKEN;
const HAS_KV = !!(KV_REST_URL && KV_REST_URL.startsWith('https://') && KV_REST_TOKEN);

// In-memory store with TTL tracking
const memoryStore = new Map();
const MEMORY_MAX_SIZE = 500;

// ─────────────────────────────────────────────────
// Upstash REST helpers (no SDK dependency needed)
// ─────────────────────────────────────────────────

/**
 * Execute a raw Upstash REST command.
 * @param {string[]} command
 * @returns {Promise<any>}
 */
async function upstashCommand(command) {
    const resolvedKvRestUrl = KV_REST_URL;
    if (typeof resolvedKvRestUrl !== 'string' || resolvedKvRestUrl.length === 0) {
        throw new Error('[Cache] KV_REST_URL is not configured');
    }
    const res = await fetch(resolvedKvRestUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${KV_REST_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
    });

    if (!res.ok) {
        throw new Error(`Upstash REST ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const data = await res.json();
    return data.result;
}

/**
 * Get a value from Upstash KV.
 * @param {string} key
 * @returns {Promise<string | null>}
 */
async function kvGet(key) {
    return upstashCommand(['GET', key]);
}

/**
 * Set a value in Upstash KV with TTL.
 * @param {string} key
 * @param {string} value
 * @param {number} ttl — seconds
 * @returns {Promise<void>}
 */
async function kvSetEx(key, value, ttl) {
    await upstashCommand(['SETEX', key, String(ttl), value]);
}

/**
 * Delete a key from Upstash KV.
 * @param {string} key
 * @returns {Promise<void>}
 */
async function kvDel(key) {
    await upstashCommand(['DEL', key]);
}

// ─────────────────────────────────────────────────
// In-memory store helpers
// ─────────────────────────────────────────────────

function memGet(/** @type {string | number | boolean | null | undefined} */ key) {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        memoryStore.delete(key);
        return null;
    }
    return entry.value;
}

function memSet(/** @type {string | number | boolean | null | undefined} */ key, /** @type {string | number | boolean | null | undefined} */ value, /** @type {number} */ ttl) {
    // Evict oldest entries if store is too large
    if (memoryStore.size >= MEMORY_MAX_SIZE) {
        const firstKey = memoryStore.keys().next().value;
        memoryStore.delete(firstKey);
    }
    memoryStore.set(key, {
        value,
        expiresAt: Date.now() + ttl * 1000,
    });
}

function memDel(/** @type {string | number | boolean | null | undefined} */ key) {
    memoryStore.delete(key);
}

// ─────────────────────────────────────────────────
// CacheService
// ─────────────────────────────────────────────────

export class CacheService {
    constructor() {
        this.backend = HAS_KV ? 'upstash' : 'memory';
    }

    /**
     * Get a cached value or compute + cache it.
     *
     * @template T
     * @param {string} key — Cache key (e.g. 'openfisca:rsa:<hash>')
     * @param {() => Promise<T>} fetchFn — Function to call on cache miss
     * @param {number} [ttl=3600] - Time-to-live in seconds (default 1h)
     * @returns {Promise<T>}
     */
    async getOrSet(key, fetchFn, ttl = 3600) {
        const prefixed = `cache:${key}`;

        try {
            // Try cache hit
            const cached = this.backend === 'upstash'
                ? await kvGet(prefixed)
                : memGet(prefixed);

            if (cached !== null) {
                return JSON.parse(typeof cached === 'string' ? cached : JSON.stringify(cached));
            }
        } catch (err) {
            // Cache read failure → proceed to fetch (never block on cache errors)
            console.warn(`[Cache] Read error for ${key}:`, (err instanceof Error ? err.message : String(err)));
        }

        // Cache miss → fetch
        const freshData = await fetchFn();

        try {
            const serialized = JSON.stringify(freshData);
            if (this.backend === 'upstash') {
                await kvSetEx(prefixed, serialized, ttl);
            } else {
                memSet(prefixed, serialized, ttl);
            }
        } catch (err) {
            // Cache write failure → non-fatal
            console.warn(`[Cache] Write error for ${key}:`, (err instanceof Error ? err.message : String(err)));
        }

        return freshData;
    }

    /**
     * Invalidate a cached key.
     * @param {string} key
     * @returns {Promise<void>}
     */
    async invalidate(key) {
        const prefixed = `cache:${key}`;
        try {
            if (this.backend === 'upstash') {
                await kvDel(prefixed);
            } else {
                memDel(prefixed);
            }
        } catch (err) {
            console.warn(`[Cache] Invalidate error for ${key}:`, (err instanceof Error ? err.message : String(err)));
        }
    }

    /**
     * Get cache backend info (for health checks).
     * @returns {{backend: string, memorySize: number}}
     */
    getInfo() {
        return {
            backend: this.backend,
            memorySize: memoryStore.size,
        };
    }
}

/** Singleton instance */
export const cache = new CacheService();

export default cache;
