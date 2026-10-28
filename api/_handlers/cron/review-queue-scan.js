import logger from '../../_utils/logger.js';
import { randomUUID } from 'crypto';
import { getCronAuth, getHeader } from '../../_utils/cronAuth.js';
import { env } from '../../_utils/env.js';
import { db } from '../../../src/db/index.js';
import { scanDataQuality } from '../../_utils/dataQuality.js';

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @returns {number}
 */
function parseLimit(raw, fallback) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parseJsonBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return /** @type {Record<string, unknown>} */ (parsed);
    } catch {
      return {};
    }
  }
  return {};
}


/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();

  res.setHeader('x-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  const auth = getCronAuth(req);

  if (!auth.ok && auth.reason === 'missing_secret') {
    return res.status(500).json({ error: 'CRON_SECRET is not configured', requestId });
  }

  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized', requestId });
  }

  if (!env.dataQuality.reviewScanCronEnabled) {
    return res.status(200).json({
      ok: true,
      requestId,
      skipped: true,
      reason: 'disabled',
      summary: {
        scanned: {},
        created: 0,
        updated: 0,
        openTotal: null,
        byReason: {},
        bySeverity: {},
        byEntityType: {},
      },
    });
  }

  try {
    const body = parseJsonBody(req.body);
    const limitFromBody = body.limitPerType;
    const limitFromQuery = req.query?.limitPerType;
    const requestedLimit = limitFromBody == null ? limitFromQuery : limitFromBody;
    const limitPerType = parseLimit(requestedLimit, env.dataQuality.reviewScanCronLimitPerType);

    const summary = await scanDataQuality({
      db,
      limitPerType,
    });

    return res.status(200).json({
      ok: true,
      requestId,
      summary,
    });
  } catch (error) {
    logger.error(
      {
        requestId,
        path: 'cron/review-queue/scan',
        method: req.method,
        error: error instanceof Error ? error.message : 'unknown_error',
      },
      'cron.review_queue_scan.error',
    );

    return res.status(500).json({
      ok: false,
      requestId,
      error: 'internal',
    });
  }
}
