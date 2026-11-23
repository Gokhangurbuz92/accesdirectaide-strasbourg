// @ts-nocheck
/**
 * G14 — the 25 purge steps of the expansion content (X04 events, X02 testimonials, X01 stories, X05 job listings, X03 Entraide) and of the account-free
 * DSA notices. Durations: the versioned policy (api/_services/retention-policy.js, version g14-expansion-1-2026-11-22-a7-365d), decided by the controller
 * (décision du responsable 22/11/2026, formulaire G14, questions 14–28). The steps follow the rules of api/_handlers/cron/gdpr-purge.js: a dry run by
 * default; each one executes only once the controller records its OWN approval in the policy (approvedSteps: dry run read, backup verified) and the operator
 * lists it in GDPR_PURGE_APPROVED_STEPS; X03 steps also wait for the dedicated X03 AIPD (decidedSteps condition, STEP_CONDITION_OPEN).
 * Safeguards on every step that touches a person: an ACTIVE legal hold on any id the row carries, a processing restriction (art. 18 GDPR) or an open access
 * request of the person. A missing table (a database before 0053–0059) skips the step (skipped_steps). Erasures follow the paths of the services: a
 * testimonial or story that expires unread goes the way of a withdrawal (text erased, reports deleted, a ConsentLog « decision false » row written); an
 * idle Entraide offer or request is closed the way its member would close it (shared e-mails deleted, each with its consent withdrawal).
 * Built by a factory (no import cycle): gdpr-purge.js passes its own safeguard SQL. ALIASES: the safeguards use « h » (LegalHold) and « r » (DSRRequest,
 * restriction) in their own subqueries — a row expression passed to them must never use those aliases (« t », « m », « er », « o » here).
 */
import { inArray, sql } from 'drizzle-orm';
import { CHARTER_PURPOSE, endActiveRequests } from './entraide.js';
import { EntraideRequest } from '../../src/db/schema.js';

/** proof rows written by the purge itself (not a choice of the person) */
const RETENTION_PROOF = { channel: 'retention_policy', proof: 'RETENTION_POLICY' };
const parisDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * @param {{ heldSql: (...ids: any[]) => any, personProtectedSql: (subject: any) => any }} h
 * @returns {import('../_handlers/cron/gdpr-purge.js').PurgeStep[]}
 */
export function expansionSteps({ heldSql, personProtectedSql }) {
  const n = async (db, q) => Number(((await db.execute(q))?.rows || [])[0]?.n ?? 0);
  const rc = (r) => Number(r?.rowCount ?? r?.rows?.length ?? 0);
  /** safe for a person-linked row: not held (any id), the person not restricted / no open request */
  const safe = (person, ...ids) => sql`NOT ${heldSql(person, ...ids)} AND NOT ${personProtectedSql(person)}`;
  /** a plain delete step on one table with a WHERE on alias t */
  const del = (table, where) => ({
    count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} t WHERE ${where(ctx)}`),
    run: async (db, ctx) => rc(await db.execute(sql`DELETE FROM ${sql.identifier(table)} t WHERE ${where(ctx)}`)),
  });

  // ── X02 / X01: an unread text expires like a withdrawal ────────────────────────────────────────────────────────────────────────────────────
  const pendingWhereT = (ctx) => sql`t.status = 'pending' AND t."submittedAt" < ${ctx.cutoff('TESTIMONIAL_PENDING_DAYS')} AND ${safe(sql`t."citizenUserId"`, sql`t.id`)}`;
  const pendingWhereS = (ctx) => sql`t.status = 'pending' AND t."submittedAt" < ${ctx.cutoff('STORY_PENDING_DAYS')}
    AND ${safe(sql`(SELECT m."citizenUserId" FROM "CommunityMember" m WHERE m.id = t."memberId")`, sql`t.id`, sql`t."memberId"`)}`;
  const consentWithdrawal = (purpose, userExpr, versionExpr, refExpr, idsCte) => sql`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash,
      collection_channel, guardian_involved, proof_level, withdrawn_at, created_at)
    SELECT gen_random_uuid()::text, 'CITIZEN_USER', ${userExpr}, ${purpose}, false, ${versionExpr}, ${versionExpr} || ':' || ${purpose} || ':' || ${refExpr},
      ${RETENTION_PROOF.channel}, false, ${RETENTION_PROOF.proof}, now(), now() FROM ${idsCte}`;

  return [
    // ── X04 academy and events ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // 1. q14: the accessibility need (art. 9 explicit consent) is cleared 1 day after the event ends (both columns: EventRegistration_need_state_check)
    { id: 'eventNeedsClearedAfterEnd', summaryKey: 'event_needs_cleared', ecode: 'X04', kind: 'redact', table: 'EventRegistration', durationKey: 'EVENT_NEED_AFTER_END_DAYS',
      tables: ['EventRegistration', 'AcademyItem', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "EventRegistration" t JOIN "AcademyItem" i ON i.id = t."itemId"
        WHERE t."accessibilityNeed" IS NOT NULL AND i."endsAt" < ${ctx.cutoff('EVENT_NEED_AFTER_END_DAYS')} AND ${safe(sql`t."citizenUserId"`, sql`t.id`, sql`t."itemId"`)}`),
      run: async (db, ctx) => rc(await db.execute(sql`UPDATE "EventRegistration" t SET "accessibilityNeed" = NULL, "accessibilityNeedAt" = NULL, "updatedAt" = now()
        FROM "AcademyItem" i WHERE i.id = t."itemId" AND t."accessibilityNeed" IS NOT NULL AND i."endsAt" < ${ctx.cutoff('EVENT_NEED_AFTER_END_DAYS')}
        AND ${safe(sql`t."citizenUserId"`, sql`t.id`, sql`t."itemId"`)}`)) },
    // 2. q15: registrations 30 days after the event (a cancelled one: after its cancellation when that came first)
    { id: 'eventRegistrationsDeleted', summaryKey: 'event_registrations_deleted', ecode: 'X04', kind: 'delete', table: 'EventRegistration', durationKey: 'EVENT_REGISTRATION_AFTER_END_DAYS',
      tables: ['EventRegistration', 'AcademyItem', 'LegalHold', 'DSRRequest'], dependsOn: ['eventNeedsClearedAfterEnd'],
      ...del('EventRegistration', (ctx) => sql`EXISTS (SELECT 1 FROM "AcademyItem" i WHERE i.id = t."itemId"
        AND (CASE WHEN t.status = 'CANCELLED' THEN LEAST(t."cancelledAt", i."endsAt") ELSE i."endsAt" END) < ${ctx.cutoff('EVENT_REGISTRATION_AFTER_END_DAYS')})
        AND ${safe(sql`t."citizenUserId"`, sql`t.id`, sql`t."itemId"`)}`) },
    // 3. q16: an ended or cancelled EVENT page, 365 days after (no participant data; kept while a held / protected registration remains)
    { id: 'academyEventsEndedDeleted', summaryKey: 'academy_events_deleted', ecode: 'X04', kind: 'delete', table: 'AcademyItem', durationKey: 'ACADEMY_EVENT_ENDED_DAYS',
      tables: ['AcademyItem', 'EventRegistration', 'LegalHold', 'DSRRequest'], dependsOn: ['eventRegistrationsDeleted'],
      ...del('AcademyItem', (ctx) => sql`t.kind = 'EVENT' AND t.status IN ('published', 'cancelled', 'withdrawn')
        AND COALESCE(t."endsAt", t."cancelledAt") < ${ctx.cutoff('ACADEMY_EVENT_ENDED_DAYS')} AND NOT ${heldSql(sql`t.id`)}
        AND NOT EXISTS (SELECT 1 FROM "EventRegistration" er WHERE er."itemId" = t.id AND (${heldSql(sql`er.id`, sql`er."citizenUserId"`)} OR ${personProtectedSql(sql`er."citizenUserId"`)}))`) },

    // ── X02 testimonials ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // 4. q17: a testimonial nobody read in 60 days is withdrawn: text and name erased, reports deleted, the consent withdrawal recorded
    { id: 'testimonialsPendingExpired', summaryKey: 'testimonials_pending_expired', ecode: 'X02', kind: 'anonymise', table: 'Testimonial', durationKey: 'TESTIMONIAL_PENDING_DAYS',
      tables: ['Testimonial', 'TestimonialReport', 'ConsentLog', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "Testimonial" t WHERE ${pendingWhereT(ctx)}`),
      run: async (db, ctx) => {
        const res = await db.execute(sql`WITH gone AS (UPDATE "Testimonial" t SET status = 'withdrawn', body = NULL, "displayName" = NULL, "withdrawnAt" = now(), "updatedAt" = now()
          WHERE ${pendingWhereT(ctx)} RETURNING t.id, t."citizenUserId" AS u, t."consentVersion" AS v),
          r AS (DELETE FROM "TestimonialReport" x USING gone WHERE x."testimonialId" = gone.id RETURNING 1),
          c AS (${consentWithdrawal('TESTIMONIAL_PUBLICATION', sql`gone.u`, sql`gone.v`, sql`gone.id`, sql`gone`)} RETURNING 1)
          SELECT (SELECT count(*) FROM gone)::int AS n`);
        return Number(res?.rows?.[0]?.n ?? 0);
      } },
    // 5. q19: rows without text (rejected, withdrawn, taken down), 365 days after
    { id: 'testimonialSkeletonsDeleted', summaryKey: 'testimonial_skeletons_deleted', ecode: 'X02', kind: 'delete', table: 'Testimonial', durationKey: 'TESTIMONIAL_SKELETON_DAYS',
      tables: ['Testimonial', 'LegalHold', 'DSRRequest'], dependsOn: ['testimonialsPendingExpired'],
      ...del('Testimonial', (ctx) => sql`t.status IN ('rejected', 'withdrawn', 'taken_down') AND COALESCE(t."withdrawnAt", t."moderatedAt", t."updatedAt") < ${ctx.cutoff('TESTIMONIAL_SKELETON_DAYS')}
        AND ${safe(sql`t."citizenUserId"`, sql`t.id`)}`) },
    // 6. q20: in-app reports, 90 days at most (they are deleted at the decision already)
    { id: 'testimonialReportsDeleted', summaryKey: 'testimonial_reports_deleted', ecode: 'X02', kind: 'delete', table: 'TestimonialReport', durationKey: 'UGC_REPORT_DAYS',
      tables: ['TestimonialReport', 'LegalHold'],
      ...del('TestimonialReport', (ctx) => sql`t."createdAt" < ${ctx.cutoff('UGC_REPORT_DAYS')} AND NOT ${heldSql(sql`t."testimonialId"`, sql`t."reporterUserId"`)}`) },
    // 7. q18: REPORT ONLY — published 3 years ago: the person is asked again; nothing is removed without a decision
    { id: 'testimonialsReconfirmationReport', summaryKey: 'testimonials_to_reconfirm', ecode: 'X02', kind: 'report', table: 'Testimonial', durationKey: 'TESTIMONIAL_REVIEW_DAYS', tables: ['Testimonial'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "Testimonial" t WHERE t.status = 'published' AND t."publishedAt" < ${ctx.cutoff('TESTIMONIAL_REVIEW_DAYS')}`) },

    // ── X01 community stories ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // 8. q17
    { id: 'storiesPendingExpired', summaryKey: 'stories_pending_expired', ecode: 'X01', kind: 'anonymise', table: 'CommunityStory', durationKey: 'STORY_PENDING_DAYS',
      tables: ['CommunityStory', 'CommunityMember', 'CommunityStoryReport', 'ConsentLog', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "CommunityStory" t WHERE ${pendingWhereS(ctx)}`),
      run: async (db, ctx) => {
        const res = await db.execute(sql`WITH gone AS (UPDATE "CommunityStory" t SET status = 'withdrawn', title = NULL, body = NULL, "withdrawnAt" = now(), "updatedAt" = now()
          WHERE ${pendingWhereS(ctx)} RETURNING t.id, (SELECT m."citizenUserId" FROM "CommunityMember" m WHERE m.id = t."memberId") AS u, t."consentVersion" AS v),
          r AS (DELETE FROM "CommunityStoryReport" x USING gone WHERE x."storyId" = gone.id RETURNING 1),
          c AS (${consentWithdrawal('COMMUNITY_STORY_PUBLICATION', sql`gone.u`, sql`gone.v`, sql`gone.id`, sql`gone`)} RETURNING 1)
          SELECT (SELECT count(*) FROM gone)::int AS n`);
        return Number(res?.rows?.[0]?.n ?? 0);
      } },
    // 9. q19
    { id: 'storySkeletonsDeleted', summaryKey: 'story_skeletons_deleted', ecode: 'X01', kind: 'delete', table: 'CommunityStory', durationKey: 'STORY_SKELETON_DAYS',
      tables: ['CommunityStory', 'CommunityMember', 'LegalHold', 'DSRRequest'], dependsOn: ['storiesPendingExpired'],
      ...del('CommunityStory', (ctx) => sql`t.status IN ('rejected', 'withdrawn', 'taken_down') AND COALESCE(t."withdrawnAt", t."moderatedAt", t."updatedAt") < ${ctx.cutoff('STORY_SKELETON_DAYS')}
        AND ${safe(sql`(SELECT m."citizenUserId" FROM "CommunityMember" m WHERE m.id = t."memberId")`, sql`t.id`, sql`t."memberId"`)}`) },
    // 10. q20
    { id: 'storyReportsDeleted', summaryKey: 'story_reports_deleted', ecode: 'X01', kind: 'delete', table: 'CommunityStoryReport', durationKey: 'UGC_REPORT_DAYS',
      tables: ['CommunityStoryReport', 'LegalHold'],
      ...del('CommunityStoryReport', (ctx) => sql`t."createdAt" < ${ctx.cutoff('UGC_REPORT_DAYS')} AND NOT ${heldSql(sql`t."storyId"`, sql`t."reporterUserId"`)}`) },
    // 11. q18: REPORT ONLY
    { id: 'storiesReconfirmationReport', summaryKey: 'stories_to_reconfirm', ecode: 'X01', kind: 'report', table: 'CommunityStory', durationKey: 'STORY_REVIEW_DAYS', tables: ['CommunityStory'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "CommunityStory" t WHERE t.status = 'published' AND t."publishedAt" < ${ctx.cutoff('STORY_REVIEW_DAYS')}`) },
    // 12. q21: a pseudonym without a pending or published story, 730 days after its last activity (its text-less rows cascade). Question 22 (freeze a
    //     deleted pseudonym) is OPEN: a deleted pseudonym can be chosen again, as today.
    { id: 'communityMembersInactiveDeleted', summaryKey: 'community_members_deleted', ecode: 'X01', kind: 'delete', table: 'CommunityMember', durationKey: 'COMMUNITY_MEMBER_INACTIVE_DAYS',
      tables: ['CommunityMember', 'CommunityStory', 'LegalHold', 'DSRRequest'], dependsOn: ['storiesPendingExpired'],
      ...del('CommunityMember', (ctx) => sql`NOT EXISTS (SELECT 1 FROM "CommunityStory" s WHERE s."memberId" = t.id AND s.status IN ('pending', 'published'))
        AND GREATEST(t."createdAt", COALESCE((SELECT max(s."updatedAt") FROM "CommunityStory" s WHERE s."memberId" = t.id), t."createdAt")) < ${ctx.cutoff('COMMUNITY_MEMBER_INACTIVE_DAYS')}
        AND ${safe(sql`t."citizenUserId"`, sql`t.id`)}`) },

    // ── X05 job listings ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // 13. q25: a published listing past its end date is marked expired every day (the public read already never serves it)
    { id: 'jobListingsExpiredMarked', summaryKey: 'job_listings_expired_marked', ecode: 'X05', kind: 'anonymise', table: 'JobListing', durationKey: null, tables: ['JobListing', 'LegalHold'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "JobListing" t WHERE t.status = 'published' AND t."expiresOn" < ${parisDay(ctx.now)}::date AND NOT ${heldSql(sql`t.id`, sql`t."structureId"`)}`),
      run: async (db, ctx) => rc(await db.execute(sql`UPDATE "JobListing" t SET status = 'expired', "updatedAt" = now()
        WHERE t.status = 'published' AND t."expiresOn" < ${parisDay(ctx.now)}::date AND NOT ${heldSql(sql`t.id`, sql`t."structureId"`)}`)) },
    // 14. q23: the application channel (it can be a named recruiter's address) of an ended listing, 30 days after its end (JobListing_apply_check allows NULL then)
    { id: 'jobListingApplyTargetsErased', summaryKey: 'job_apply_targets_erased', ecode: 'X05', kind: 'redact', table: 'JobListing', durationKey: 'JOB_APPLY_TARGET_AFTER_END_DAYS',
      tables: ['JobListing', 'LegalHold'], dependsOn: ['jobListingsExpiredMarked'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "JobListing" t WHERE t."applyTarget" IS NOT NULL AND ${jobEnded(ctx, 'JOB_APPLY_TARGET_AFTER_END_DAYS', heldSql)}`),
      run: async (db, ctx) => rc(await db.execute(sql`UPDATE "JobListing" t SET "applyTarget" = NULL, "updatedAt" = now()
        WHERE t."applyTarget" IS NOT NULL AND ${jobEnded(ctx, 'JOB_APPLY_TARGET_AFTER_END_DAYS', heldSql)}`)) },
    // 15. q25: an ended listing (expired, withdrawn, taken down), 365 days after its end
    { id: 'jobListingsEndedDeleted', summaryKey: 'job_listings_ended_deleted', ecode: 'X05', kind: 'delete', table: 'JobListing', durationKey: 'JOB_LISTING_ENDED_DAYS',
      tables: ['JobListing', 'LegalHold'], dependsOn: ['jobListingsExpiredMarked'],
      ...del('JobListing', (ctx) => jobEnded(ctx, 'JOB_LISTING_ENDED_DAYS', heldSql)) },
    // 16. q25: a draft, or a rejected listing not sent again, 180 days after its last change
    { id: 'jobListingDraftsDeleted', summaryKey: 'job_listing_drafts_deleted', ecode: 'X05', kind: 'delete', table: 'JobListing', durationKey: 'JOB_LISTING_DRAFT_DAYS',
      tables: ['JobListing', 'LegalHold'],
      ...del('JobListing', (ctx) => sql`t.status IN ('draft', 'rejected') AND t."updatedAt" < ${ctx.cutoff('JOB_LISTING_DRAFT_DAYS')} AND NOT ${heldSql(sql`t.id`, sql`t."structureId"`)}`) },

    // ── X03 Entraide (decided with the dedicated AIPD: STEP_CONDITION_OPEN until it is signed) ─────────────────────────────────────────────────
    // 17. q27: an open / paused offer idle for 90 days is closed as its member would close it (note erased, active requests ended, shared e-mails deleted)
    { id: 'entraideOffersIdleClosed', summaryKey: 'entraide_offers_idle_closed', ecode: 'X03', kind: 'anonymise', table: 'EntraideOffer', durationKey: 'ENTRAIDE_OFFER_IDLE_DAYS',
      tables: ['EntraideOffer', 'EntraideMember', 'EntraideRequest', 'EntraideContactShare', 'ConsentLog', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "EntraideOffer" t WHERE ${offerIdle(ctx, safe)}`),
      run: async (db, ctx) => {
        const ids = ((await db.execute(sql`SELECT t.id FROM "EntraideOffer" t WHERE ${offerIdle(ctx, safe)} FOR UPDATE`))?.rows || []).map((r) => String(r.id));
        if (!ids.length) return 0;
        await endActiveRequests(db, inArray(EntraideRequest.offerId, ids), ctx.now);
        await db.execute(sql`UPDATE "EntraideOffer" SET status = 'closed', note = NULL, "closedAt" = now(), "updatedAt" = now() WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
        return ids.length;
      } },
    // 18. q27: a request nobody answered in 30 days is withdrawn (note erased)
    { id: 'entraideRequestsPendingExpired', summaryKey: 'entraide_requests_pending_expired', ecode: 'X03', kind: 'anonymise', table: 'EntraideRequest', durationKey: 'ENTRAIDE_REQUEST_PENDING_DAYS',
      tables: ['EntraideRequest', 'EntraideMember', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "EntraideRequest" t WHERE ${requestWhere(ctx, 'pending', safe)}`),
      run: async (db, ctx) => rc(await db.execute(sql`UPDATE "EntraideRequest" t SET status = 'withdrawn', note = NULL, "closedAt" = now(), "updatedAt" = now() WHERE ${requestWhere(ctx, 'pending', safe)}`)) },
    // 19. q26: an ACCEPTED request without activity for 90 days ends; the e-mails shared on it are deleted (each with its consent withdrawal)
    { id: 'entraideRequestsAcceptedEnded', summaryKey: 'entraide_requests_accepted_ended', ecode: 'X03', kind: 'anonymise', table: 'EntraideRequest', durationKey: 'ENTRAIDE_REQUEST_ACCEPTED_DAYS',
      tables: ['EntraideRequest', 'EntraideMember', 'EntraideContactShare', 'ConsentLog', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "EntraideRequest" t WHERE ${requestWhere(ctx, 'accepted', safe)}`),
      run: async (db, ctx) => {
        const ids = ((await db.execute(sql`SELECT t.id FROM "EntraideRequest" t WHERE ${requestWhere(ctx, 'accepted', safe)} FOR UPDATE`))?.rows || []).map((r) => String(r.id));
        return ids.length ? endActiveRequests(db, inArray(EntraideRequest.id, ids), ctx.now) : 0;
      } },
    // 20. q27: a finished request (declined, withdrawn, ended), 365 days after it closed
    { id: 'entraideRequestsEndedDeleted', summaryKey: 'entraide_requests_ended_deleted', ecode: 'X03', kind: 'delete', table: 'EntraideRequest', durationKey: 'ENTRAIDE_REQUEST_ENDED_DAYS',
      tables: ['EntraideRequest', 'EntraideMember', 'LegalHold', 'DSRRequest'], dependsOn: ['entraideRequestsPendingExpired', 'entraideRequestsAcceptedEnded'],
      ...del('EntraideRequest', (ctx) => sql`t.status IN ('declined', 'withdrawn', 'ended') AND t."closedAt" < ${ctx.cutoff('ENTRAIDE_REQUEST_ENDED_DAYS')}
        AND ${safe(sql`(SELECT m."citizenUserId" FROM "EntraideMember" m WHERE m.id = t."requesterId")`, sql`t.id`, sql`t."requesterId"`)}`) },
    // 21. q27: a closed offer, 365 days after — only once no request of it remains (the cascade would take more recent ones)
    { id: 'entraideOffersClosedDeleted', summaryKey: 'entraide_offers_closed_deleted', ecode: 'X03', kind: 'delete', table: 'EntraideOffer', durationKey: 'ENTRAIDE_OFFER_CLOSED_DAYS',
      tables: ['EntraideOffer', 'EntraideMember', 'EntraideRequest', 'LegalHold', 'DSRRequest'], dependsOn: ['entraideRequestsEndedDeleted', 'entraideOffersIdleClosed'],
      ...del('EntraideOffer', (ctx) => sql`t.status = 'closed' AND t."closedAt" < ${ctx.cutoff('ENTRAIDE_OFFER_CLOSED_DAYS')}
        AND NOT EXISTS (SELECT 1 FROM "EntraideRequest" r WHERE r."offerId" = t.id)
        AND ${safe(sql`(SELECT m."citizenUserId" FROM "EntraideMember" m WHERE m.id = t."memberId")`, sql`t.id`, sql`t."memberId"`)}`) },
    // 22. q27: reports, 365 days at most (deleted at the decision already)
    { id: 'entraideReportsDeleted', summaryKey: 'entraide_reports_deleted', ecode: 'X03', kind: 'delete', table: 'EntraideReport', durationKey: 'ENTRAIDE_REPORT_DAYS',
      tables: ['EntraideReport', 'LegalHold'],
      ...del('EntraideReport', (ctx) => sql`t."createdAt" < ${ctx.cutoff('ENTRAIDE_REPORT_DAYS')} AND NOT ${heldSql(sql`t."reporterId"`, sql`t."targetId"`)}`) },
    // 23. q27: REPORT ONLY — a suspension older than 365 days, for a human review (never lifted automatically)
    { id: 'entraideSuspensionsReview', summaryKey: 'entraide_suspensions_to_review', ecode: 'X03', kind: 'report', table: 'EntraideMember', durationKey: 'ENTRAIDE_SUSPENSION_REVIEW_DAYS',
      tables: ['EntraideMember'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "EntraideMember" t WHERE t.status = 'suspended' AND t."suspendedAt" < ${ctx.cutoff('ENTRAIDE_SUSPENSION_REVIEW_DAYS')}`) },
    // 24. q27: an ACTIVE member without any activity for 730 days leaves (charter withdrawal recorded first, as `leave`); a suspended one waits for review
    { id: 'entraideMembersInactiveDeleted', summaryKey: 'entraide_members_deleted', ecode: 'X03', kind: 'delete', table: 'EntraideMember', durationKey: 'ENTRAIDE_MEMBER_INACTIVE_DAYS',
      tables: ['EntraideMember', 'EntraideOffer', 'EntraideRequest', 'EntraideContactShare', 'ConsentLog', 'LegalHold', 'DSRRequest'],
      count: (db, ctx) => n(db, sql`SELECT count(*)::int AS n FROM "EntraideMember" t WHERE ${memberIdle(ctx, safe)}`),
      run: async (db, ctx) => {
        const res = await db.execute(sql`WITH gone AS (SELECT t.id, t."citizenUserId" AS u, t."charterVersion" AS v FROM "EntraideMember" t WHERE ${memberIdle(ctx, safe)} FOR UPDATE),
          c AS (${consentWithdrawal(CHARTER_PURPOSE, sql`gone.u`, sql`gone.v`, sql`gone.id`, sql`gone`)} RETURNING 1),
          d AS (DELETE FROM "EntraideMember" x USING gone WHERE x.id = gone.id RETURNING 1)
          SELECT (SELECT count(*) FROM d)::int AS n`);
        return Number(res?.rows?.[0]?.n ?? 0);
      } },

    // ── DSA notices without an account ───────────────────────────────────────────────────────────────────────────────────────────────────────
    // 25. q28: a decided notice (name, address, explanation), 365 days after the decision — kept while an appeal on it is open
    { id: 'contentNoticesDeleted', summaryKey: 'content_notices_deleted', ecode: 'DSA', kind: 'delete', table: 'ContentNotice', durationKey: 'CONTENT_NOTICE_AFTER_DECISION_DAYS',
      tables: ['ContentNotice', 'ModerationAppeal', 'LegalHold'],
      ...del('ContentNotice', (ctx) => sql`t.status = 'decided' AND t."decidedAt" < ${ctx.cutoff('CONTENT_NOTICE_AFTER_DECISION_DAYS')} AND NOT ${heldSql(sql`t.id`)}
        AND NOT EXISTS (SELECT 1 FROM "ModerationAppeal" a WHERE a."noticeId" = t.id AND a.status = 'open')`) },
    // ── G14-PS: social referrals (0061) — PROPOSAL, duration pendingApproval: never executes before the owner confirms it ─────────────────────────
    { id: 'socialReferralsClosedDeleted', summaryKey: 'social_referrals_deleted', ecode: 'G14-PS', kind: 'delete', table: 'SocialReferral', durationKey: 'SOCIAL_REFERRAL_CLOSED_DAYS',
      tables: ['SocialReferral', 'SocialReferralEvent', 'LegalHold', 'DSRRequest'],
      ...del('SocialReferral', (ctx) => sql`t."closedAt" IS NOT NULL AND t."closedAt" < ${ctx.cutoff('SOCIAL_REFERRAL_CLOSED_DAYS')}
        AND ${sql`NOT ${heldSql(sql`t."citizenId"`, sql`t.id`, sql`t."fromStructureId"`, sql`t."toStructureId"`)}`}
        AND (t."citizenId" IS NULL OR NOT ${personProtectedSql(sql`t."citizenId"`)})`) },
  ];
}

/** an ended listing past `key` days after its end (expired: its end date; withdrawn: withdrawnAt; taken down: moderatedAt), not held */
function jobEnded(ctx, key, heldSql) {
  return sql`t.status IN ('expired', 'withdrawn', 'taken_down')
    AND COALESCE(CASE t.status WHEN 'expired' THEN t."expiresOn"::timestamp WHEN 'withdrawn' THEN t."withdrawnAt" ELSE t."moderatedAt" END, t."updatedAt") < ${ctx.cutoff(key)}
    AND NOT ${heldSql(sql`t.id`, sql`t."structureId"`)}`;
}
function offerIdle(ctx, safe) {
  return sql`t.status IN ('open', 'paused') AND t."updatedAt" < ${ctx.cutoff('ENTRAIDE_OFFER_IDLE_DAYS')}
    AND ${safe(sql`(SELECT m."citizenUserId" FROM "EntraideMember" m WHERE m.id = t."memberId")`, sql`t.id`, sql`t."memberId"`)}`;
}
function requestWhere(ctx, status, safe) {
  const anchor = status === 'pending' ? sql`t."createdAt" < ${ctx.cutoff('ENTRAIDE_REQUEST_PENDING_DAYS')}` : sql`COALESCE(t."decidedAt", t."updatedAt") < ${ctx.cutoff('ENTRAIDE_REQUEST_ACCEPTED_DAYS')}`;
  return sql`t.status = ${status} AND ${anchor}
    AND ${safe(sql`(SELECT m."citizenUserId" FROM "EntraideMember" m WHERE m.id = t."requesterId")`, sql`t.id`, sql`t."requesterId"`, sql`t."offerId"`)}
    AND ${safe(sql`(SELECT m."citizenUserId" FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE o.id = t."offerId")`)}`;
}
function memberIdle(ctx, safe) {
  return sql`t.status = 'active' AND GREATEST(t."updatedAt",
      COALESCE((SELECT max(o."updatedAt") FROM "EntraideOffer" o WHERE o."memberId" = t.id), t."updatedAt"),
      COALESCE((SELECT max(r."updatedAt") FROM "EntraideRequest" r WHERE r."requesterId" = t.id), t."updatedAt")) < ${ctx.cutoff('ENTRAIDE_MEMBER_INACTIVE_DAYS')}
    AND ${safe(sql`t."citizenUserId"`, sql`t.id`)}`;
}
