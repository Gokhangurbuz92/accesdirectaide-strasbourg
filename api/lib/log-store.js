// @ts-nocheck
/**
 * Log Store — Centralized log aggregation via Upstash Redis.
 *
 * Stores the last N log entries in a Redis list for quick admin access.
 * Gracefully degrades if Redis is unavailable (logs to console).
 */
import { Redis } from '@upstash/redis';

const MAX_LOGS = 500;
const LOG_KEY = 'app:logs';

/** @type {Redis | null} */
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Store a log entry in Redis.
 * @param {'info'|'warn'|'error'|'critical'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export async function storeLog(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const redis = getRedis();
  if (!redis) {
    console.log('[LOG-STORE] No Redis, skipping:', JSON.stringify(entry));
    return;
  }

  try {
    await redis.lpush(LOG_KEY, JSON.stringify(entry));
    await redis.ltrim(LOG_KEY, 0, MAX_LOGS - 1);
  } catch (err) {
    console.error('[LOG-STORE] Failed:', err.message);
  }
}

/**
 * Retrieve recent log entries.
 * @param {number} [count=50]
 * @returns {Promise<Array<{ timestamp: string, level: string, message: string }>>}
 */
/** R7: whether a central log store is configured here (without one, an empty list means « not collected », not « nothing happened »). */
export function logStoreConfigured() {
  return Boolean(getRedis());
}

export async function getLogs(count = 50) {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const raw = await redis.lrange(LOG_KEY, 0, count - 1);
    return raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
  } catch (err) {
    console.error('[LOG-STORE] Read failed:', err.message);
    return [];
  }
}
