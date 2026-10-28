import logger from '../../_utils/logger.js';
import { randomUUID } from 'crypto';
import { db } from '../../../src/db/index.js';
import { env } from '../../_utils/env.js';
import { applyNoIndex } from '../../_utils/robots.js';

const TIMEOUT_MS = 2000;

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

/**
 * @param {Date | null} latestFetchedAt
 * @param {number} thresholdHours
 */
function computeFreshness(latestFetchedAt, thresholdHours) {
  if (!latestFetchedAt) {
    return { ok: false, state: 'missing', ageHours: null };
  }

  const ageHours = Math.max(0, Math.floor((Date.now() - latestFetchedAt.getTime()) / 3600000));
  if (ageHours > thresholdHours) {
    return { ok: false, state: 'stale', ageHours };
  }
  return { ok: true, state: 'fresh', ageHours };
}

/**
 * Public monitoring endpoint for ingestion freshness.
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

  const thresholdHours = env.monitor.ingestionFreshnessMaxAgeHours;

  try {
    const latest = await withTimeout(
      db.query.SourceDocument.findFirst({
        orderBy: (sd, { desc }) => [desc(sd.fetched_at)],
        columns: { fetched_at: true },
      }),
      TIMEOUT_MS,
    );

    const latestFetchedAt = latest?.fetched_at ?? null;
    const freshness = computeFreshness(latestFetchedAt, thresholdHours);
    const statusCode = freshness.ok ? 200 : 503;

    if (!freshness.ok) {
      logger.warn(
        {
          requestId,
          route: 'monitor/ingestion-freshness',
          state: freshness.state,
          ageHours: freshness.ageHours,
        },
        'monitor.ingestion_freshness.unavailable',
      );
    }

    return res.status(statusCode).json({
      ok: freshness.ok,
      requestId,
      state: freshness.state,
      latestFetchedAt: latestFetchedAt ? latestFetchedAt.toISOString() : null,
      ageHours: freshness.ageHours,
      thresholdHours,
      ...(freshness.ok ? {} : { error: 'unavailable' }),
    });
  } catch {
    logger.warn(
      {
        requestId,
        route: 'monitor/ingestion-freshness',
      },
      'monitor.ingestion_freshness.error',
    );

    return res.status(503).json({
      ok: false,
      requestId,
      state: 'error',
      latestFetchedAt: null,
      ageHours: null,
      thresholdHours,
      error: 'unavailable',
    });
  }
}
