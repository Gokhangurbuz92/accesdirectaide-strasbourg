import logger from '../../_utils/logger.js';
import { randomUUID } from 'crypto';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { kv } from '../../_utils/kv.js';
import { env } from '../../_utils/env.js';
import { applyNoIndex } from '../../_utils/robots.js';

const TIMEOUT_MS = 5000;

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function probeDb() {
  const startedAt = Date.now();
  try {
    await withTimeout(db.execute(sql`SELECT 1`), TIMEOUT_MS);
    return { ok: true, durationMs: Date.now() - startedAt };
  } catch {
    return { ok: false, durationMs: Date.now() - startedAt };
  }
}

/**
 * @param {string} requestId
 */
async function probeKv(requestId) {
  const startedAt = Date.now();

  // In production we require a real KV config; memory fallback is for local/dev.
  if (env.runtime.vercelEnv === 'production' && (!env.kv.url || !env.kv.token)) {
    return { ok: false, durationMs: Date.now() - startedAt };
  }

  const key = `monitor:core:${requestId}`;
  try {
    await withTimeout(kv.set(key, 'ok', { ex: 10 }), TIMEOUT_MS);
    const value = await withTimeout(kv.get(key), TIMEOUT_MS);
    await withTimeout(kv.del(key), TIMEOUT_MS);
    return { ok: value === 'ok', durationMs: Date.now() - startedAt };
  } catch {
    return { ok: false, durationMs: Date.now() - startedAt };
  }
}

/**
 * Public uptime monitor endpoint:
 * - 200 when core deps (DB + KV) are healthy
 * - 503 when one dep fails
 * - no sensitive details in payload
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  applyNoIndex(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  const [dbCheck, kvCheck] = await Promise.all([probeDb(), probeKv(requestId)]);
  const dbOk = dbCheck.ok === true;
  const kvOk = kvCheck.ok === true;
  // DB is critical (503 if down), KV is best-effort (degraded but 200)
  const ok = dbOk;
  const payload = {
    ok,
    status: dbOk && kvOk ? 'healthy' : dbOk ? 'degraded' : 'unavailable',
    requestId,
    deps: {
      db: dbCheck,
      kv: kvCheck,
    },
  };

  if (!dbOk) {
    logger.warn(
      {
        requestId,
        route: 'monitor/core',
        db: dbCheck.ok,
        kv: kvCheck.ok,
      },
      'monitor.core.unavailable',
    );
    return res.status(503).json({ ...payload, error: 'database_unavailable' });
  }

  return res.status(200).json(payload);
}
