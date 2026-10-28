// @ts-nocheck
import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import logger from '../_utils/logger.js';

/**
 * Search Cache — Redis-backed caching for search results.
 *
 * Uses Upstash KV (same backend as rate limiting).
 * TTL: 5 minutes. Cache key: SHA-256 of serialized params.
 */

const CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX = 'search:';
const EPOCH_KEY = 'search:content-epoch';

/** @type {Redis|null} */
let redis = null;

// R12: every cache call is bounded (an unreachable store used to retry for tens of seconds and hold the admin write or the search behind it); a timeout is a cache miss
const KV_BOUND_MS = 3000;
/** @template T @param {Promise<T>} p @returns {Promise<T>} */
function bounded(p) {
    let timer;
    return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`cache timeout ${KV_BOUND_MS} ms`)), KV_BOUND_MS); })]).finally(() => clearTimeout(timer));
}

function getRedis() {
    if (redis) return redis;
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    redis = new Redis({ url, token });
    return redis;
}

/**
 * Hash search params into a stable cache key.
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function hashParams(params) {
    const sorted = JSON.stringify(params, Object.keys(params).sort());
    return crypto.createHash('sha256').update(sorted).digest('hex').substring(0, 16);
}

/**
 * Execute a search with Redis caching.
 *
 * @param {Record<string, unknown>} params - Search parameters (used for cache key)
 * @param {() => Promise<unknown>} searchFn - Function that performs the actual search
 * @returns {Promise<{ data: unknown, cached: boolean }>}
 */
export async function cachedSearch(params, searchFn) {
    const client = getRedis();
    // D-5: the key carries a content epoch that every verification/hold/release bumps, so a record that stops being public disappears from cached results at once (TTL stays the fallback).
    const epoch = client ? await readEpoch(client) : 0;
    const cacheKey = `${CACHE_PREFIX}${epoch}:${hashParams(params)}`;

    // Try cache (only if Redis is configured)
    if (client) {
        try {
            const cached = await bounded(client.get(cacheKey));
            if (cached) {
                logger.info(`[search-cache] HIT ${cacheKey}`);
                // Upstash auto-deserializes JSON
                const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
                return { data, cached: true };
            }
        } catch (err) {
            logger.warn(`[search-cache] Redis GET failed: ${err.message}`);
        }
    }

    // Cache miss — execute search
    const data = await searchFn();

    // Store result in cache (fire-and-forget, don't block response) — R14: never an incomplete result (a section that failed is not cached as « no result »)
    if (client && !(Array.isArray(data?.partial) && data.partial.length)) {
        try {
            await bounded(client.set(cacheKey, JSON.stringify(data), { ex: CACHE_TTL_SECONDS }));
            logger.info(`[search-cache] MISS — stored ${cacheKey} (TTL ${CACHE_TTL_SECONDS}s)`);
        } catch (err) {
            logger.warn(`[search-cache] Redis SET failed: ${err.message}`);
        }
    }

    return { data, cached: false };
}

// Exported for testing
export { hashParams, CACHE_TTL_SECONDS, CACHE_PREFIX };

/** @param {Redis} client */
async function readEpoch(client) {
    try {
        const v = await bounded(client.get(EPOCH_KEY));
        return Number(v) || 0;
    } catch (err) {
        logger.warn(`[search-cache] epoch read failed: ${err.message}`);
        return 0;
    }
}

/**
 * Invalidate every cached search result (used when the public visibility of any record changes).
 * @returns {Promise<{ bumped: boolean }>} bumped:false means no cache is configured or Redis failed (then only the TTL bounds staleness)
 */
export async function bumpContentEpoch() {
    const client = getRedis();
    if (!client) return { bumped: false };
    try {
        await bounded(client.incr(EPOCH_KEY));
        return { bumped: true };
    } catch (err) {
        logger.warn(`[search-cache] epoch bump failed: ${err.message}`);
        return { bumped: false };
    }
}
