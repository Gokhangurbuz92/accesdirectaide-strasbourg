import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { db } from '../../../src/db/index.js';
import { CronRun } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';
import { parsePaginationParams, buildPaginatedResponse } from '../../lib/geography/CursorPagination.js';

/**
 * @param {string | undefined} url
 * @param {string | undefined} host
 * @returns {string | null}
 */
function extractIdFromPath(url, host = 'localhost') {
  if (!url) return null;
  try {
    const urlObj = new URL(url, `https://${host}`);
    const pathname = urlObj.pathname || '';
    const match = pathname.match(/^\/(?:api\/)?admin\/cron-runs\/([^/?#]+)/);
    if (!match) return null;
    const raw = decodeURIComponent(match[1] || '').trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Admin: list cron runs + detail (protected by admin auth).
 *
 * Routes:
 * - GET /api/admin/cron-runs?job=actualites&limit=50
 * - GET /api/admin/cron-runs/:id
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(/** @type {{ status?: number }} */ (rateLimit))).json(rateLimit.error);
    }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!(await verifyAdmin(req))) {
    return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
  }

  const id = extractIdFromPath(req.url, req.headers?.host);
  if (id) {
    const item = await db.query.CronRun.findFirst({
      where: eq(CronRun.id, id),
    });

    if (!item) return res.status(404).json({ error: 'Not found' });

    return res.status(200).json({ item });
  }

  const job = req.query?.job ? String(req.query.job) : undefined;
  const pagination = parsePaginationParams(req.query);
  const limit = pagination.limit;

  const items = await db.query.CronRun.findMany({
    where: job ? eq(CronRun.job, job) : undefined,
    orderBy: (cr, { desc }) => [desc(cr.startedAt)],
    limit: limit + 1,
    columns: {
      id: true,
      job: true,
      status: true,
      trigger: true,
      skipReason: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      requestId: true,
      metrics: true,
    },
  });

  return res.status(200).json({ items });
}
