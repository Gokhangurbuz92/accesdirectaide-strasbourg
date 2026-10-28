// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { randomUUID } from 'crypto';
import { db } from '../../../src/db/index.js';
import { ReviewQueueItem, AuditLog } from '../../../src/db/schema.js';
import { eq, inArray, and, desc, sql } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { reviewQueuePatchSchema, reviewQueueBulkPatchSchema } from '../../../src/db/drizzle-schemas.js';
import { suggestionsAllowed } from '../../_services/repair-suggestions.js';
import {
  normalizeEntityType,
  normalizeReviewStatus,
  parsePatchStatus,
  scanDataQuality,
} from '../../_utils/dataQuality.js';

/**
 * PKG-6 / D22: every human decision on the queue leaves an AuditLog row with the NAMED administrator (MFA session, checked by adminGate before any write),
 * the items, from / to status, whether an AI suggestion was attached, and the stated reason when given. 'resolved_by_ai' is never a human decision.
 * (Owner decision 2026-10-21: the retired shared ADMIN_TOKEN no longer writes here, in any environment; reads keep verifyAdmin.)
 * @param {{ email: string, mfa_verified?: boolean, authType?: string }} auth @param {object} details
 */
async function auditDecision(auth, details) {
  await db.insert(AuditLog).values({ action: 'REVIEW_QUEUE_DECISION', actor: auth.email, actor_id: auth.email, entity: 'ReviewQueueItem', entity_id: details.itemId || null,
    details: { ...details, mfa: auth.mfa_verified === true, authType: auth.authType } });
}
const reasonOf = (body) => { const r = typeof body?.reason === 'string' ? body.reason.trim() : ''; return r ? r.slice(0, 500) : null; };
const isOpen = (s) => String(s).toLowerCase() === 'open';   // writers use 'open' and 'OPEN'

/**
 * @param {string | undefined} url
 * @param {string | undefined} host
 */
function extractPath(url, host = 'localhost') {
  if (!url) return '';
  try {
    return new URL(url, `https://${host}`).pathname || '';
  } catch {
    return '';
  }
}

/**
 * @param {string} pathname
 */
function extractReviewQueueId(pathname) {
  const match = pathname.match(/^\/(?:api\/)?admin\/review-queue\/([^/?#]+)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1] || '').trim();
  const lowered = raw.toLowerCase();
  if (!raw || lowered === 'scan' || lowered === 'bulk') return null;
  return raw;
}

/**
 * @param {string} pathname
 */
function isScanPath(pathname) {
  return /^\/(?:api\/)?admin\/review-queue\/scan\/?$/.test(pathname);
}

/**
 * @param {string} pathname
 */
function isBulkPath(pathname) {
  return /^\/(?:api\/)?admin\/review-queue\/bulk\/?$/.test(pathname);
}

/**
 * @param {unknown} raw
 */
function parseJsonBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 */
function parseLimit(raw, fallback) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 200);
}

/**
 * @param {unknown} raw
 */
function parseReason(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.slice(0, 120);
}

/**
 * @param {unknown} raw
 * @returns {string[] | null}
 */
function parseBulkIds(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > 200) return null;

  /** @type {string[]} */
  const out = [];
  const seen = new Set();

  for (const candidate of raw) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length > 200) return null;
  }

  if (out.length === 0) return null;
  return out;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();

  if (!(await verifyAdmin(req))) {
    return res.status(401).json({ error: 'Unauthorized: Admin Token Required', requestId });
  }

  const pathname = extractPath(req.url, req.headers?.host);
  const itemId = extractReviewQueueId(pathname);
  /** @type {any} */ let writer = null;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase())) {   // PKG-6 / D22: named administrator + MFA for every write
    writer = await adminGate(req, res, { write: true }); if (!writer) return;
  }

  try {
    if (req.method === 'POST') {
      if (!isScanPath(pathname)) {
        return res.status(404).json({ error: 'Not found', requestId });
      }

      const body = parseJsonBody(req.body);
      const bodyLimit = /** @type {{ limitPerType?: unknown }} */ (body).limitPerType;
      const limitPerType = bodyLimit == null ? undefined : parseLimit(bodyLimit, 200);

      const summary = await scanDataQuality({
        db,
        limitPerType,
      });

      return res.status(200).json({
        ok: true,
        requestId,
        ...summary,
      });
    }

    if (req.method === 'GET') {
      const status = normalizeReviewStatus(req.query?.status, 'open');
      const entityType = normalizeEntityType(req.query?.entityType);
      const reason = parseReason(req.query?.reason);
      const limit = parseLimit(req.query?.limit, 50);
      const cursor = req.query?.cursor ? String(req.query.cursor).trim() : null;

      const conditions = [];
      // PKG-11 audit: writers use 'open' and 'OPEN' (and lowercase decisions): the filter ignores case (it used to miss every lowercase row)
      if (status) conditions.push(sql`lower(${ReviewQueueItem.status}) = ${status.toLowerCase()}`);
      if (entityType) conditions.push(eq(ReviewQueueItem.entityType, entityType.toUpperCase()));
      if (reason) conditions.push(eq(ReviewQueueItem.reason, reason));
      let selectQuery = db.select().from(ReviewQueueItem).$dynamic();
      if (conditions.length > 0) {
        selectQuery = selectQuery.where(and(...conditions));
      }
      const items = await selectQuery.orderBy(desc(ReviewQueueItem.createdAt), desc(ReviewQueueItem.id)).limit(limit + 1);


      let nextCursor = null;
      if (items.length > limit) {
        const next = items.pop();
        nextCursor = next?.id || null;
      }

      return res.status(200).json({
        ok: true,
        requestId,
        items: items.map((i) => ({ ...i, status: String(i.status || '').toLowerCase() })),   // one spelling for the page (its row actions test 'open')
        // owner LAB audit: the page offers « suggestion IA » only when one can be produced (switch on AND the AI policy allows the provider for administrators)
        aiSuggestions: { available: process.env.ENABLE_AI_AGENT === 'true' && suggestionsAllowed() },
        pagination: {
          limit,
          nextCursor,
        },
      });
    }

    if (req.method === 'PATCH') {
      if (isBulkPath(pathname)) {
        const bulkResult = reviewQueueBulkPatchSchema.safeParse(parseJsonBody(req.body));
        if (!bulkResult.success) {
          return res.status(400).json({ error: 'Invalid bulk payload', requestId, details: bulkResult.error.flatten() });
        }

        const { ids, status: nextStatus } = bulkResult.data;
        if (nextStatus === 'resolved_by_ai') return res.status(400).json({ error: 'resolved_by_ai is not a human decision', requestId });

        const existing = await db.select({ id: ReviewQueueItem.id, status: ReviewQueueItem.status, details: ReviewQueueItem.details }).from(ReviewQueueItem).where(inArray(ReviewQueueItem.id, ids));

        const updatableIds = existing
          .filter(/** @param {{ id: string, status: string }} item */ (item) => isOpen(item.status))
          .map(/** @param {{ id: string }} item */ (item) => item.id);
        // PKG-11 audit: the same rule as one item — a decision on an AI suggestion needs the reviewer's reason (bulk used to skip it)
        const withAi = existing.filter((/** @type {any} */ e) => updatableIds.includes(e.id) && (e.details?.ai_suggestion || e.details?.ai_fix));
        if (withAi.length && (reasonOf(parseJsonBody(req.body)) || '').length < 10) {
          return res.status(400).json({ error: 'REASON_REQUIRED', message: `Décision sur ${withAi.length} suggestion(s) de l’IA : indiquez votre motif (au moins 10 caractères).`, requestId });
        }

        const updateResult = updatableIds.length > 0
          ? await db.update(ReviewQueueItem).set({ status: nextStatus }).where(
              and(inArray(ReviewQueueItem.id, updatableIds), inArray(ReviewQueueItem.status, ['open', 'OPEN']))
            ).returning({ id: ReviewQueueItem.id })
          : [];

        const updated = updateResult.length;
        if (updated) await auditDecision(writer, { reason: reasonOf(parseJsonBody(req.body)), bulk: true, ids: updateResult.map((r) => r.id), to: nextStatus, withAiSuggestion: existing.filter((e) => updatableIds.includes(e.id) && (e.details?.ai_suggestion || e.details?.ai_fix)).length });
        const existingCount = existing.length;
        const notFound = Math.max(0, ids.length - existingCount);
        const skipped = Math.max(0, existingCount - updated);

        return res.status(200).json({
          ok: true,
          requestId,
          result: {
            updated,
            skipped,
            notFound,
          },
        });
      }

      if (!itemId) {
        return res.status(400).json({ error: 'Missing review queue item id', requestId });
      }

      const patchResult = reviewQueuePatchSchema.safeParse(parseJsonBody(req.body));
      if (!patchResult.success) {
        return res.status(400).json({ error: 'Invalid status', requestId, details: patchResult.error.flatten() });
      }

      const { status: nextStatus } = patchResult.data;
      if (nextStatus === 'resolved_by_ai') return res.status(400).json({ error: 'resolved_by_ai is not a human decision', requestId });

      const [before] = await db.select({ status: ReviewQueueItem.status, details: ReviewQueueItem.details }).from(ReviewQueueItem).where(eq(ReviewQueueItem.id, itemId));
      if ((before?.details?.ai_suggestion || before?.details?.ai_fix) && (reasonOf(parseJsonBody(req.body)) || '').length < 10) {
        return res.status(400).json({ error: 'REASON_REQUIRED', message: 'Décision sur une suggestion de l’IA : indiquez votre motif (au moins 10 caractères).', requestId });
      }
      const [item] = await db.update(ReviewQueueItem).set({ status: nextStatus }).where(eq(ReviewQueueItem.id, itemId)).returning();
      if (!item) {
        return res.status(404).json({ error: 'Not found', requestId });
      }
      await auditDecision(writer, { reason: reasonOf(parseJsonBody(req.body)), itemId, from: before?.status ?? null, to: nextStatus, withAiSuggestion: Boolean(before?.details?.ai_suggestion || before?.details?.ai_fix) });

      return res.status(200).json({
        ok: true,
        requestId,
        item,
      });
    }

    return res.status(405).json({ error: 'Method Not Allowed', requestId });
  } catch (error) {
    logger.error(
      {
        requestId,
        path: pathname,
        method: req.method,
        error: error instanceof Error ? error.message : 'unknown_error',
      },
      'admin.review_queue.error',
    );

    if (error instanceof Error && error.message.includes('Not found')) {
      return res.status(404).json({ error: 'Not found', requestId });
    }

    return res.status(500).json({ ok: false, requestId, error: 'internal' });
  }
}
