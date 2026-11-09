// @ts-nocheck

import { createClient } from '@vercel/kv';
import { env } from './env.js';
import logger from './logger.js';



const memoryStore = new Map();

/**
 * @type {import("@vercel/kv").VercelKV}
 */
let kvClient;

if (env.kv.url && env.kv.token) {
    kvClient = createClient({
        url: env.kv.url,
        token: env.kv.token
    });
} else {
    logger.warn("[KV] Missing Credentials - Using Memory Store (Dev Mode)");
}

export const kv = {
    async set(key, value, opts) {
        if (kvClient) return kvClient.set(key, value, opts);

        // Memory fallback (Dev only)
        // opts: { ex: seconds, nx?: boolean }
        const now = Date.now();

        // Best-effort support for NX semantics used by cron locks / rate limiting.
        if (opts?.nx) {
            const existing = memoryStore.get(key);
            if (existing) {
                if (!existing.expires || now <= existing.expires) {
                    return null;
                }
                // Existing expired => treat as missing.
                memoryStore.delete(key);
            }
        }

        memoryStore.set(key, { value, expires: opts?.ex ? now + opts.ex * 1000 : null });
        return 'OK';
    },
    /**
   * @param {string} key
   */
    async get(key) {
        if (kvClient) return kvClient.get(key);

        const data = memoryStore.get(key);
        if (!data) return null;
        if (data.expires && Date.now() > data.expires) {
            memoryStore.delete(key);
            return null;
        }
        return data.value;
    },
    /**
     * @param {string} key
     */
    async del(key) {
        if (kvClient) return kvClient.del(key);
        return memoryStore.delete(key) ? 1 : 0;   // the number of keys removed, like Redis DEL (single-use tokens rely on it)
    },
    // Add other methods if needed
    /**
     * @param {string} key
     */
    async incr(key) {
        if (kvClient) return kvClient.incr(key);
        const data = memoryStore.get(key);
        let val = (data?.value || 0) + 1;
        memoryStore.set(key, { value: val, expires: data?.expires });
        return val;
    },
    /**
     * @param {string} key
     * @param {number} seconds
     */
    /** true when a real KV store is configured (Production), false for the in-memory development fallback */
    get isRemote() { return Boolean(kvClient); },
    /** list push at the head (Redis LPUSH) @param {string} key @param {string} value */
    async lpush(key, value) {
        if (kvClient) return kvClient.lpush(key, value);
        const data = memoryStore.get(key); const list = Array.isArray(data?.value) ? data.value : [];
        list.unshift(value); memoryStore.set(key, { value: list, expires: data?.expires ?? null });
        return list.length;
    },
    /** @param {string} key @param {number} start @param {number} stop */
    async lrange(key, start, stop) {
        if (kvClient) return kvClient.lrange(key, start, stop);
        const data = memoryStore.get(key);
        if (!data || (data.expires && Date.now() > data.expires)) return [];
        const list = Array.isArray(data.value) ? data.value : [];
        return list.slice(start, stop < 0 ? list.length + stop + 1 : stop + 1);
    },
    /** @param {string} key @param {number} start @param {number} stop */
    async ltrim(key, start, stop) {
        if (kvClient) return kvClient.ltrim(key, start, stop);
        const data = memoryStore.get(key);
        if (data && Array.isArray(data.value)) data.value = data.value.slice(start, stop < 0 ? data.value.length + stop + 1 : stop + 1);
        return 'OK';
    },
    async expire(key, seconds) {
        if (kvClient) return kvClient.expire(key, seconds);
        const data = memoryStore.get(key);
        if (data) {
            data.expires = Date.now() + seconds * 1000;
            memoryStore.set(key, data);
        }
        return 1;
    }
};
