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
