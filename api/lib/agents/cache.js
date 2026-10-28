// @ts-nocheck
/**
 * Cache Strategy — Task 32
 *
 * Source-level caching for expensive operations.
 * In-memory cache with TTL support per source type.
 * Privacy-safe: caches source metadata, NOT user prompts or PII.
 */

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Simple in-memory cache with TTL and max-size eviction.
 */
export class SourceCache {
  constructor({ maxSize = 100, defaultTtlMs = DEFAULT_CACHE_TTL_MS } = {}) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this.cache = new Map();
  }

  /**
   * Get a cached value.
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a cached value.
   * @param {string} key
   * @param {any} value
   * @param {{ ttlMs?: number }} options
   */
  set(key, value, { ttlMs } = {}) {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || this.defaultTtlMs)
    });
  }

  /**
   * Check if key exists and is not expired.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a cached value.
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cached values.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   * @returns {{ size: number, maxSize: number }}
   */
  stats() {
    // Clean expired entries
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
}

// Singleton caches for different data types
export const verificationCache = new SourceCache({ maxSize: 200, defaultTtlMs: 15 * 60 * 1000 }); // 15 min
export const sourceCache = new SourceCache({ maxSize: 100, defaultTtlMs: 5 * 60 * 1000 });       // 5 min
export const classificationCache = new SourceCache({ maxSize: 50, defaultTtlMs: 2 * 60 * 1000 }); // 2 min
