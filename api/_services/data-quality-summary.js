// @ts-nocheck
/**
 * PKG-5 / A08 — data-quality dashboard: the WS2 findings workflow state in numbers (measured, nothing estimated).
 *   - WS2 launch records by state and dataset (human verification only from the ContentVerification ledger), with the age of the oldest pending record
 *   - review queue (ReviewQueueItem) open items by reason and age bucket
 *   - public content reports and structure suggestions by status
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ws2Queue } from './ws2-review.js';

export async function dataQualitySummary({ db = defaultDb, root } = {}) {
  const q = await ws2Queue({ db, root });
  const byDataset = {};
  for (const r of q.records) { byDataset[r.dataset] ||= {}; byDataset[r.dataset][r.state] = (byDataset[r.dataset][r.state] || 0) + 1; }
  const queue = (await db.execute(sql`SELECT reason, count(*)::int AS n,
      count(*) FILTER (WHERE "createdAt" < NOW() - interval '7 days')::int AS "olderThan7d", count(*) FILTER (WHERE "createdAt" < NOW() - interval '30 days')::int AS "olderThan30d"
    FROM "ReviewQueueItem" WHERE status = 'open' GROUP BY reason ORDER BY n DESC`)).rows;
  const reports = (await db.execute(sql`SELECT status::text AS status, count(*)::int AS n FROM "ContentReport" GROUP BY status ORDER BY status`)).rows;
  const suggestions = (await db.execute(sql`SELECT status, count(*)::int AS n FROM "PartnershipRequest" GROUP BY status ORDER BY status`)).rows;
  return { ok: true, generatedAt: new Date().toISOString(),
    ws2: { totals: q.totals, byDataset, rule: 'HUMAN_VERIFIED only from a ledger VERIFY by a named MFA administrator; research notes and CSV flags never count' },
    reviewQueue: queue, contentReports: reports, structureSuggestions: suggestions };
}
