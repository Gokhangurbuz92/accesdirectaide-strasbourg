// @ts-nocheck
/**
 * Owner LAB audit (2026-10-25) — « À traiter »: what waits for a person, one count per review screen. Each count comes from that screen's own service or rule
 * (the same as the screen shows) and is isolated: a failing count is reported as null (« indisponible »), it never blanks the dashboard. Counts only — no
 * personal data, no journalised reading (the list functions used here only read).
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ws2Queue } from './ws2-review.js';
import { candidates as duplicateCandidates } from './duplicate-register.js';
import { reviewQueue as proposalQueue } from './structure-proposals.js';
import { listPending as falcPending } from './falc-governance.js';
import { listOpen as openAccessRequests } from './dsr-review.js';
import { listOpenErasures } from './dsr-erasure-review.js';
import { listOpenClosures } from './org-closure.js';
import { pendingBreakGlass } from './admin-identity.js';
import { list as aiOversightList } from './ai-oversight.js';

const firstRow = async (db, query) => (await db.execute(query)).rows?.[0] ?? {};

/** @param {{ db?: any, root?: string }} [opts] */
export async function adminTasks({ db = defaultDb, root } = {}) {
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const [ws2, organizations, duplicates, proposals, falc, accessRequests, erasures, closures, breakGlass, aiSuggestions, reports, quality, support] = await Promise.all([
    safe(async () => (await ws2Queue({ db, root })).totals),
    // the identity / record decision of each organization (Structure.verification_status + the ledger's hold), as the Organizations screen shows it
    safe(async () => {
      const r = await firstRow(db, sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE verification_status = 'VERIFIED' AND publication_hold IS NULL)::int AS verified,
          count(*) FILTER (WHERE verification_status = 'REJECTED')::int AS rejected,
          count(*) FILTER (WHERE publication_hold IS NOT NULL AND verification_status IS DISTINCT FROM 'REJECTED')::int AS "onHold",
          count(*) FILTER (WHERE publication_hold IS NULL AND verification_status IS DISTINCT FROM 'VERIFIED' AND verification_status IS DISTINCT FROM 'REJECTED')::int AS never
        FROM "Structure" WHERE statut IS DISTINCT FROM 'archive'`);
      return { total: r.total, verified: r.verified, rejected: r.rejected, onHold: r.onHold, never: r.never };
    }),
    safe(async () => (await duplicateCandidates({ db })).candidates.length),
    safe(async () => (await proposalQueue(db, { status: 'PENDING' })).proposals.length),
    safe(async () => (await falcPending(db)).drafts.length),
    safe(async () => (await openAccessRequests(db)).requests.length),
    safe(async () => (await listOpenErasures(db)).requests.length),
    safe(async () => (await listOpenClosures(db)).requests.length),
    safe(async () => (await pendingBreakGlass({ db })).length),
    safe(async () => (await aiOversightList(db)).aiSuggestions.length),
    safe(async () => (await firstRow(db, sql`SELECT count(*)::int AS n FROM "ContentReport" WHERE status IN ('NEW', 'IN_PROGRESS')`)).n),
    // writers use 'open' and 'OPEN' (see admin/review-queue)
    safe(async () => (await firstRow(db, sql`SELECT count(*)::int AS n FROM "ReviewQueueItem" WHERE lower(status) = 'open'`)).n),
    safe(async () => (await firstRow(db, sql`SELECT count(*)::int AS n FROM "SupportRequest" WHERE upper(status) IN ('OPEN', 'IN_PROGRESS')`)).n),
  ]);
  return { ws2, organizations, duplicates, proposals, falc, accessRequests, erasures, closures, breakGlass, aiSuggestions, reports, quality, support };
}
