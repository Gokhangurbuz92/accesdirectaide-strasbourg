// @ts-nocheck
/**
 * Owner LAB audit (2026-10-25) — « À traiter »: what waits for a person, one count per review screen. Each count comes from that screen's own service or rule
 * (the same as the screen shows) and is isolated: a failing count is reported as null (« indisponible »), it never blanks the dashboard. Counts only — no
 * personal data, no journalised reading (the list functions used here only read).
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ws2Queue } from './ws2-review.js';
import { countCandidates as countDuplicateCandidates } from './duplicate-register.js';
import { MAIL_CONTACT_FAILED, MAIL_CONTACT_RESOLVED } from './mail-contact-failures.js';
import { REQUEST_TYPE as CLOSURE_REQUEST_TYPE } from './org-closure.js';
import { pendingBreakGlass } from './admin-identity.js';
import { AI_PENDING } from './ai-oversight.js';

const firstRow = async (db, query) => (await db.execute(query)).rows?.[0] ?? {};
/** R7 admin: an exact count(*) with the screen's own rule — the list functions stop at 100 / 200 rows, so their length undercounted a long queue */
const countOf = async (db, query) => (await firstRow(db, query)).n;

/** @param {{ db?: any, root?: string }} [opts] */
export async function adminTasks({ db = defaultDb, root } = {}) {
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const [ws2, organizations, duplicates, proposals, falc, accessRequests, erasures, closures, breakGlass, aiSuggestions, reports, quality, support, mailContactFailures, proRegistrations,
    dsaAppeals, partnerships, newsInbox, adaArticles, externalBookings, legalHoldReleases, ownershipRecovery, fundingDossiers, institutionAccounts] = await Promise.all([
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
    safe(async () => (await countDuplicateCandidates({ db })).total),   // every open pair (the list page shows at most its own page)
    // R7 admin: exact counts, each with the rule of its screen's list (structure-proposals reviewQueue, falc-governance listPending, dsr-review listOpen,
    // dsr-erasure-review listOpenErasures, org-closure listOpenClosures, ai-oversight list, mail-contact-failures listMailContactFailures)
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "StructureProposal" WHERE status = 'PENDING'`)),
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "AiOutputReview" WHERE kind = 'FALC' AND status = 'PENDING'`)),
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "DSRRequest" WHERE "requestType" = 'ACCESS_REVIEW' AND status IN ('IN_REVIEW', 'RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'APPROVED', 'EXECUTING')`)),
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "DSRRequest" WHERE "requestType" = 'DELETE' AND status IN ('IN_REVIEW', 'BLOCKED', 'RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'APPROVED', 'EXECUTING')`)),
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "DSRRequest" r JOIN "Structure" s ON s.id = r."subjectId" WHERE r."requestType" = ${CLOSURE_REQUEST_TYPE} AND r.status IN ('IN_REVIEW', 'BLOCKED')`)),
    safe(async () => (await pendingBreakGlass({ db })).length),
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "ReviewQueueItem" WHERE ${AI_PENDING}`)),
    safe(async () => (await firstRow(db, sql`SELECT count(*)::int AS n FROM "ContentReport" WHERE status IN ('NEW', 'IN_PROGRESS')`)).n),
    // writers use 'open' and 'OPEN' (see admin/review-queue)
    safe(async () => (await firstRow(db, sql`SELECT count(*)::int AS n FROM "ReviewQueueItem" WHERE lower(status) = 'open'`)).n),
    safe(async () => (await firstRow(db, sql`SELECT count(*)::int AS n FROM "SupportRequest" WHERE upper(status) IN ('OPEN', 'IN_PROGRESS')`)).n),
    // legal v6 / C6: Mailjet contact deletions that failed for good — « intervention humaine requise » (api/_services/mail-contact-failures.js)
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "AuditLog" f WHERE f.action = ${MAIL_CONTACT_FAILED}
        AND NOT EXISTS (SELECT 1 FROM "AuditLog" r WHERE r.action = ${MAIL_CONTACT_RESOLVED} AND r.details->>'failureId' = f.id)`)),
    // R4.2 (owner test 24/11): ADA Pro sign-up requests waiting for « Vérifier et activer » (/admin/organizations?decision=pro_pending) — they were only
    // reachable through the optional « Contrôles manuels » menu, so the owner could not find the request he had just sent.
    // R7 admin: only a request that can be decided — the structure's first administrator (api/_services/pro-self-registration.js), not every pending role
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "ProUser" WHERE status = 'pending_verification' AND upper(role) = 'STRUCTURE_ADMIN'`)),
    // R7 admin: the queues that had no card — each the default list of its screen
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "ModerationAppeal" WHERE status = 'open'`)),   // /admin/moderation, appeals
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "PartnershipRequest" WHERE status = 'pending'`)),   // /admin/signalements, suggestions
    // /admin/inbox: imported drafts (an ADA original moves only through its editorial workflow)
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "Actualite" WHERE statut = 'brouillon' AND coalesce(type_actu, '') <> 'ada_original'`)),
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "Actualite" WHERE statut = 'a_relire' AND type_actu = 'ada_original'`)),   // /admin/actualites-redaction
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "StructureExternalBooking" WHERE status = 'PENDING'`)),   // /admin/rdv-externes
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "LegalHold" WHERE status = 'ACTIVE' AND "releaseProposedBy" IS NOT NULL`)),   // /admin/privacy, second person
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "OwnershipRecoveryCase" WHERE status = 'PROPOSED'`)),   // /admin/privacy, second person
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "FundingDossier" WHERE status = 'PRET_POUR_VALIDATION'`)),   // /admin/financement, the holder's validation
    safe(async () => countOf(db, sql`SELECT count(*)::int AS n FROM "InstitutionAccount" WHERE status = 'PENDING_AGREEMENT'`)),   // /admin/institutions
  ]);
  return { ws2, organizations, duplicates, proposals, falc, accessRequests, erasures, closures, breakGlass, aiSuggestions, reports, quality, support, mailContactFailures, proRegistrations,
    dsaAppeals, partnerships, newsInbox, adaArticles, externalBookings, legalHoldReleases, ownershipRecovery, fundingDossiers, institutionAccounts };
}
