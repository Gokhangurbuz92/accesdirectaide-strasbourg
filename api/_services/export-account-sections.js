// @ts-nocheck
/**
 * A-14 (art. 15 completeness) — the account-keyed tables the personal-data export used to omit. Each section is MINIMISED: only the person's own rows, and
 * never a secret or an identifier that only serves the platform (push endpoint and its hash, encrypted subscription, token hashes, staff identities).
 *
 *   pushSubscriptions       PushSubscription        (userId)                       no endpoint, no endpointHash, no subscriptionEncrypted
 *   emailChangeRequests     EmailChangeRequest      (userId)                       the requested address (the person typed it), no tokenHash
 *   ownershipRecoveryCases  OwnershipRecoveryCase   (citizenUserId)                status and dates only: the address claimed in a recovery request is not proven to be
 *                                                                                  the person's until the case is approved (it may be a third party's), and the
 *                                                                                  evidence / decision notes and staff identities are the controller's own records
 *   parcoursReminders       ParcoursReminder        (itemId -> ParcoursItem.userId)
 *   appointmentNotices      AppointmentNotice       (appointmentId -> ProAppointment.citizenUserId), recipient 'citizen' only (a notice sent to the professional is not theirs)
 *   eventRegistrations      EventRegistration       (citizenUserId) X04: event, state, times, the accessibility need the person chose — only on a database with 0053
 *   testimonials            Testimonial             (citizenUserId) X02: state, chosen name and text while they exist, language, moderation reason, times — with 0054
 *   testimonialReports      TestimonialReport       (reporterUserId) X02: the reports the person made (testimonial id, reason, time) — with 0054
 *   communityMember         CommunityMember         (citizenUserId) X01: the pseudonym and the date the person joined — with 0055
 *   communityStories        CommunityStory          (memberId -> CommunityMember.citizenUserId) X01: state, title and text while they exist, language, reason, times — with 0055
 *   communityStoryReports   CommunityStoryReport    (reporterUserId) X01: the reports the person made (story id, reason, time) — with 0055
 *   entraideMember          EntraideMember          (citizenUserId) X03: pseudonym, state, suspension reason, charter version and time — with 0057
 *   entraideOffers          EntraideOffer           (memberId -> EntraideMember.citizenUserId) X03: the person's offers (category, area, note while it exists, state)
 *   entraideRequests        EntraideRequest         (requesterId -> …) X03: the requests the person SENT (category, area, own note, state, times)
 *   entraideRequestsReceived EntraideRequest        (offer of the person) X03: requests received — states and times only (the note is the requester's data)
 *   entraideContactShares   EntraideContactShare    (memberId -> …) X03: the e-mails the person chose to show (request id, address, time)
 *   entraideReports         EntraideReport          (reporterId -> …) X03: the reports the person made (reason, time — not whom)
 *   entraideBlocks          EntraideBlock           (blockerId -> …) X03: the blocks the person set (id, time — not whom)
 *
 * EXPORT_SECTION_TABLES is the contract read by tests/unit/a14-export-covers-account-tables.test.js: a new table with a foreign key to CitizenUser must be
 * exported (here or in privacy.js) or the test fails.
 */
import { sql } from 'drizzle-orm';
import { openText } from '../lib/data-keys.js';

export const EXPORT_SECTION_TABLES = Object.freeze({
  pushSubscriptions: 'PushSubscription', emailChangeRequests: 'EmailChangeRequest', ownershipRecoveryCases: 'OwnershipRecoveryCase',
  parcoursReminders: 'ParcoursReminder', appointmentNotices: 'AppointmentNotice', eventRegistrations: 'EventRegistration',
  testimonials: 'Testimonial', testimonialReports: 'TestimonialReport',
  communityMember: 'CommunityMember', communityStories: 'CommunityStory', communityStoryReports: 'CommunityStoryReport',
  entraideMember: 'EntraideMember', entraideOffers: 'EntraideOffer', entraideRequests: 'EntraideRequest', entraideRequestsReceived: 'EntraideRequest',
  entraideContactShares: 'EntraideContactShare', entraideReports: 'EntraideReport', entraideBlocks: 'EntraideBlock',
  // G14 (0059): the moderation decisions about the person's content (statements of reasons), their appeals and the measures taken on their account
  moderationDecisions: 'ModerationDecision', moderationAppeals: 'ModerationAppeal', moderationSanctions: 'ModerationSanction',
  // G14-PS (0061): the person's social referrals (organisations, closed reasons, statuses, what they chose to share, consent channel, times)
  socialReferrals: 'SocialReferral',
  // G14-R3G (0064): the links with a court-appointed representative where the person is the protected adult or the representative (facts only; the
  // administrator's identity and note are not part of it, as for the other staff decisions)
  legalProtectionMandates: 'LegalProtectionMandate',
});

/** columns that must never appear in these sections */
export const EXPORT_FORBIDDEN_FIELDS = Object.freeze(['endpoint', 'endpointHash', 'subscriptionEncrypted', 'tokenHash', 'newEmailEncrypted', 'evidenceNote', 'decisionNote', 'proposedBy', 'decidedBy']);

/**
 * @param {string} userId
 * @param {(query: import('drizzle-orm').SQL) => Promise<any[]>} rows reads rows and counts a failed read (privacy.js safeRows)
 * @param {{ open?: (id: string, sealed: string) => string, hasEventTables?: () => Promise<boolean>, hasTestimonialTables?: () => Promise<boolean>, hasCommunityTables?: () => Promise<boolean>, hasEntraideTables?: () => Promise<boolean>, hasModerationTables?: () => Promise<boolean>, hasSocialReferralTables?: () => Promise<boolean>, hasLegalProtectionTable?: () => Promise<boolean> }} [deps]
 *   hasEventTables: migration 0053 present (X04); hasTestimonialTables: migration 0054 present (X02); hasCommunityTables: migration 0055 present (X01); hasEntraideTables: migration 0057 present (X03)
 */
export async function accountLinkedSections(userId, rows, deps = {}) {
  const open = deps.open || ((id, sealed) => openText(sealed, { purpose: 'email-change', context: `email-change:${id}` }));
  const pushSubscriptions = await rows(sql`SELECT id, "pushHost", status, "failureCount", "lastSuccessAt", "lastFailureAt", "createdAt" FROM "PushSubscription" WHERE "userId" = ${userId} ORDER BY "createdAt"`);
  const emailChangeRequests = (await rows(sql`SELECT id, "newEmailEncrypted" AS enc, "createdAt", "expiresAt", "usedAt" FROM "EmailChangeRequest" WHERE "userId" = ${userId} ORDER BY "createdAt"`))
    .map((r) => ({ id: r.id, requestedEmail: (() => { try { return String(open(r.id, r.enc) || '') || null; } catch { return null; } })(), createdAt: r.createdAt, expiresAt: r.expiresAt, usedAt: r.usedAt }));
  const ownershipRecoveryCases = await rows(sql`SELECT id, status, "proposedAt", "decidedAt" FROM "OwnershipRecoveryCase" WHERE "citizenUserId" = ${userId} ORDER BY "proposedAt"`);
  const parcoursReminders = await rows(sql`SELECT r."itemId", r.threshold, r.channel, r.status, r."createdAt" FROM "ParcoursReminder" r JOIN "ParcoursItem" i ON i.id = r."itemId" WHERE i."userId" = ${userId} ORDER BY r."createdAt"`);
  const appointmentNotices = await rows(sql`SELECT n.id, n."appointmentId", n.kind, n.channel, n.status, n."createdAt" FROM "AppointmentNotice" n JOIN "ProAppointment" a ON a.id = n."appointmentId"
    WHERE a."citizenUserId" = ${userId} AND n.recipient = 'citizen' ORDER BY n."createdAt"`);
  // X04: a database without 0053 has no registration (not a failed read: the export stays complete)
  const events = await import('./academy-events.js');
  const hasEventTables = deps.hasEventTables || (() => events.academySchemaAvailable());
  const eventRegistrations = (await hasEventTables()) ? await rows(events.eventRegistrationsExportSql(userId)) : [];
  // X02: same rule for a database without 0054
  const testimonialsSvc = await import('./testimonials.js');
  const hasTestimonialTables = deps.hasTestimonialTables || (() => testimonialsSvc.testimonialsSchemaAvailable());
  const withTestimonials = await hasTestimonialTables();
  const testimonials = withTestimonials ? await rows(testimonialsSvc.testimonialsExportSql(userId)) : [];
  const testimonialReports = withTestimonials ? await rows(testimonialsSvc.testimonialReportsExportSql(userId)) : [];
  // X01: same rule for a database without 0055
  const community = await import('./community-stories.js');
  const hasCommunityTables = deps.hasCommunityTables || (() => community.communitySchemaAvailable());
  const withCommunity = await hasCommunityTables();
  const communityMember = withCommunity ? await rows(community.communityMemberExportSql(userId)) : [];
  const communityStories = withCommunity ? await rows(community.communityStoriesExportSql(userId)) : [];
  const communityStoryReports = withCommunity ? await rows(community.communityStoryReportsExportSql(userId)) : [];
  // X03: same rule for a database without 0057
  const entraide = await import('./entraide.js');
  const hasEntraideTables = deps.hasEntraideTables || (() => entraide.entraideSchemaAvailable());
  const withEntraide = await hasEntraideTables();
  const e = async (f) => (withEntraide ? rows(f(userId)) : []);
  const entraideMember = await e(entraide.entraideMemberExportSql);
  const entraideOffers = await e(entraide.entraideOffersExportSql);
  const entraideRequests = await e(entraide.entraideRequestsExportSql);
  const entraideRequestsReceived = await e(entraide.entraideRequestsReceivedExportSql);
  const entraideContactShares = await e(entraide.entraideContactSharesExportSql);
  const entraideReports = await e(entraide.entraideReportsExportSql);
  const entraideBlocks = await e(entraide.entraideBlocksExportSql);
  // G14: same rule for a database without 0059 (who reported is never part of it)
  const moderation = await import('./moderation-dsa.js');
  const withModeration = await (deps.hasModerationTables || (() => moderation.moderationSchemaAvailable()))();
  const m = async (f) => (withModeration ? rows(f(userId)) : []);
  const moderationDecisions = await m(moderation.moderationDecisionsExportSql);
  const moderationAppeals = await m(moderation.moderationAppealsExportSql);
  const moderationSanctions = await m(moderation.moderationSanctionsExportSql);
  // G14-PS: same rule for a database without 0061
  const social = await import('./social-referrals.js');
  const withSocial = await (deps.hasSocialReferralTables || (() => social.socialReferralsAvailable()))();
  const socialReferrals = withSocial ? await rows(social.socialReferralsExportSql(userId)) : [];
  // G14-R3G: same rule for a database without 0064
  const lp = await import('./legal-protection.js');
  const withLegalProtection = await (deps.hasLegalProtectionTable || (() => lp.legalProtectionInstalled()))();
  const legalProtectionMandates = withLegalProtection ? await rows(sql`SELECT id, CASE WHEN "protectedUserId" = ${userId} THEN 'PROTECTED_PERSON' ELSE 'REPRESENTATIVE' END AS role,
      "representativeKind", "mjpmForm", siret, measure, mode, "scopePerson", "scopeAssets", areas, "courtName", "decisionDate", "measureEndsOn", "validUntil",
      status, "personContestedAt", "verifiedAt", "verificationMethod", "endedAt", "endedBy", "endReason", "createdAt"
    FROM "LegalProtectionMandate" WHERE "protectedUserId" = ${userId} OR "representativeUserId" = ${userId} ORDER BY "createdAt"`) : [];
  return { pushSubscriptions, emailChangeRequests, ownershipRecoveryCases, parcoursReminders, appointmentNotices, eventRegistrations, testimonials, testimonialReports,
    communityMember, communityStories, communityStoryReports,
    entraideMember, entraideOffers, entraideRequests, entraideRequestsReceived, entraideContactShares, entraideReports, entraideBlocks,
    moderationDecisions, moderationAppeals, moderationSanctions, socialReferrals, legalProtectionMandates };
}
