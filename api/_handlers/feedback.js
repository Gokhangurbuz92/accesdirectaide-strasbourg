// @ts-nocheck
import logger from '../_utils/logger.js';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';

import { db } from '../../src/db/index.js';
import { ContentReport } from '../../src/db/schema.js';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { isFeatureOn } from '../_services/feature-flags.js';

const CONTENT_TYPE_MAP = {
  aide: 'AIDE',
  demarche: 'DEMARCHE',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null}
 */
function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === 'object') return /** @type {Record<string, unknown>} */ (body);
  return {};
}

/**
 * @param {string | null} rawUrl
 * @returns {string | null}
 */
function normalizePageUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  const requestId = req.requestId || randomUUID();
  const log = logger.child({ handler: 'feedback', requestId });

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      requestId,
      error: 'method_not_allowed',
    });
  }

  // R12 (P19): this path also files a ContentReport — the PUBLIC_FEEDBACK kill switch closes it like /api/reports and the structure suggestions
  if (!(await isFeatureOn('PUBLIC_FEEDBACK'))) return res.status(503).json({ ok: false, requestId, error: 'FEATURE_DISABLED', message: 'Les signalements sont momentanément fermés.' });

  const ip = getClientIp(req);
  const limit = await checkRateLimit('FEEDBACK', ip);
  if (!limit.allowed) {
    return res.status(limit.status || 429).json({
      ...(limit.error || { error: 'rate_limited' }),
      requestId,
    });
  }

  const payload = parseBody(req.body);
  const type = normalizeText(payload.type, 32)?.toLowerCase() || null;
  const id = normalizeText(payload.id, 128);
  const slug = normalizeText(payload.slug, 256);
  const message = normalizeText(payload.message, 3000);
  const email = normalizeText(payload.email, 254)?.toLowerCase() || null;
  const pageUrl = normalizePageUrl(normalizeText(payload.pageUrl, 2048));

  if (!type || !CONTENT_TYPE_MAP[type]) {
    return res.status(400).json({
      ok: false,
      requestId,
      error: 'invalid_type',
    });
  }

  if (!id && !slug) {
    return res.status(400).json({
      ok: false,
      requestId,
      error: 'missing_target',
    });
  }

  if (!message || message.length < 5) {
    return res.status(400).json({
      ok: false,
      requestId,
      error: 'invalid_message',
    });
  }

  if (email && !EMAIL_REGEX.test(email)) {
    return res.status(400).json({
      ok: false,
      requestId,
      error: 'invalid_email',
    });
  }

  try {
    const [report] = await db.insert(ContentReport).values({
        // @ts-ignore
        contentType: CONTENT_TYPE_MAP[type],
        contentId: id || `slug:${slug}`,
        reason: 'AUTRE',
        message,
        pageUrl,
        reporterEmail: email,
    }).returning();

    log.info({
      msg: 'feedback.created',
      feedbackId: report.id,
      type,
      hasId: Boolean(id),
      hasSlug: Boolean(slug),
      hasEmail: Boolean(email),
    });

    return res.status(201).json({
      ok: true,
      requestId,
      feedbackId: report.id,
      message: 'Merci pour votre signalement.',
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown';
    log.error({ msg: 'feedback.create_failed', type, errorName });

    Sentry.captureException(error, {
      tags: {
        route: 'feedback',
        requestId,
        type,
      },
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: 'internal',
    });
  }
}
