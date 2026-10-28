import crypto from 'crypto';
import { kv } from './kv.js';
import { env } from './env.js';
import logger from './logger.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MINUTE_WINDOW_SECONDS = 60;

/**
 * @param {string | undefined | null} value
 * @returns {string}
 */
function hashSafe(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

/**
 * @returns {boolean}
 */
function hasPersistentKv() {
  return Boolean(env.kv.url && env.kv.token);
}

/**
 * @param {string | undefined | null} method
 * @returns {boolean}
 */
export function isWriteMethod(method) {
  return WRITE_METHODS.has(String(method || 'GET').toUpperCase());
}

/**
 * @param {{ userId: string, structureId: string }} input
 * @returns {string}
 */
export function buildRateLimitSubjectKey(input) {
  const userId = String(input?.userId || '').trim();
  const structureId = String(input?.structureId || '').trim();
  return `${hashSafe(userId)}:${hashSafe(structureId)}`;
}

/**
 * @param {{ scope: 'read' | 'write', subject: string, bucket: string }} input
 * @returns {string}
 */
export function buildProRdvRateLimitKey(input) {
  return `rl:pro-rdv:${input.scope}:${input.subject}:${input.bucket}`;
}

/**
 * @param {number} windowSeconds
 * @param {number=} nowMs
 * @returns {number}
 */
export function computeRetryAfterSeconds(windowSeconds, nowMs = Date.now()) {
  const windowMs = Math.max(1, windowSeconds) * 1000;
  const elapsed = nowMs % windowMs;
  const remainingMs = windowMs - elapsed;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/**
 * @param {number=} nowMs
 * @returns {number}
 */
function secondsUntilUtcDayEnd(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((nextUtcMidnight - nowMs) / 1000));
}

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @returns {Promise<number>}
 */
async function incrementCounter(key, ttlSeconds) {
  const countRaw = await kv.incr(key);
  const count = Number(countRaw);
  if (count === 1) {
    await kv.expire(key, ttlSeconds);
  }
  return Number.isFinite(count) ? count : 0;
}

/**
 * @param {import('./http-types').ApiRequest} req
 * @param {import('./http-types').ApiResponse} res
 * @param {{ handlerName: string }} options
 * @returns {Promise<{ allowed: boolean, reason?: 'minute' | 'daily', retryAfterSeconds?: number }>}
 */
export async function enforceProRdvRateLimit(req, res, options) {
  const requestId = typeof req.requestId === 'string' ? req.requestId : null;
  const method = String(req.method || 'GET').toUpperCase();
  const userId = String(req.user?.userId || '').trim();
  const structureId = String(req.user?.structureId || '').trim();

  if (!userId || !structureId) {
    return { allowed: true };
  }

  const isWrite = isWriteMethod(method);
  const minuteLimit = isWrite ? env.proRdv.writePerMinute : env.proRdv.readPerMinute;
  const nowMs = Date.now();
  const subject = buildRateLimitSubjectKey({ userId, structureId });
  const minuteBucket = `m:${Math.floor(nowMs / (MINUTE_WINDOW_SECONDS * 1000))}`;
  const minuteKey = buildProRdvRateLimitKey({
    scope: isWrite ? 'write' : 'read',
    subject,
    bucket: minuteBucket,
  });

  try {
    const minuteCount = await incrementCounter(minuteKey, MINUTE_WINDOW_SECONDS);
    const minuteRemaining = Math.max(0, minuteLimit - minuteCount);

    res.setHeader('X-RateLimit-Limit', String(minuteLimit));
    res.setHeader('X-RateLimit-Remaining', String(minuteRemaining));
    res.setHeader('X-RateLimit-Window', `${MINUTE_WINDOW_SECONDS}s`);

    if (minuteCount > minuteLimit) {
      const retryAfterSeconds = computeRetryAfterSeconds(MINUTE_WINDOW_SECONDS, nowMs);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too Many Requests',
        code: 'PRO_RATE_LIMITED',
        requestId,
        retryAfterSeconds,
      });
      return { allowed: false, reason: 'minute', retryAfterSeconds };
    }

    if (!isWrite) {
      return { allowed: true };
    }

    const dailyLimit = env.proRdv.writePerDay;
    if (dailyLimit <= 0 || !hasPersistentKv()) {
      return { allowed: true };
    }

    const dayBucket = `d:${new Date(nowMs).toISOString().slice(0, 10)}`;
    const dayKey = buildProRdvRateLimitKey({
      scope: 'write',
      subject,
      bucket: dayBucket,
    });

    const dayTtl = secondsUntilUtcDayEnd(nowMs) + 60;
    const dayCount = await incrementCounter(dayKey, dayTtl);
    const dayRemaining = Math.max(0, dailyLimit - dayCount);

    res.setHeader('X-RateLimit-Day-Limit', String(dailyLimit));
    res.setHeader('X-RateLimit-Day-Remaining', String(dayRemaining));

    if (dayCount > dailyLimit) {
      const retryAfterSeconds = secondsUntilUtcDayEnd(nowMs);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too Many Requests',
        code: 'PRO_DAILY_QUOTA_EXCEEDED',
        requestId,
        retryAfterSeconds,
      });
      return { allowed: false, reason: 'daily', retryAfterSeconds };
    }

    return { allowed: true };
  } catch {
    logger.warn(
      {
        requestId,
        method,
        handler: options.handlerName,
        hasKv: hasPersistentKv(),
      },
      'pro.rdv.ratelimit.degraded',
    );

    return { allowed: true };
  }
}
