/**
 * R44 / E16 — the VERSIONED retention policy that drives cron/gdpr-purge (and the backup rotation of scripts/db-backup.mjs).
 *
 * Every duration below is the PROPOSAL of the R43 dossier (STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r43/R43_DOSSIER_RGPD_ACTIVATION_FR.md § 3.1, each one
 * « [PROPOSITION — À VALIDER RT] »). V2 phase 1 (owner, 09/11/2026): the controller approved this proposal with A7 = 365 (see RETENTION_POLICY below).
 * Before that, none was a decision: the policy status was PROPOSED — NOT APPROVED and `approvedPolicyVersion` was deliberately ABSENT.
 * Engineering never approves it. The controller's decision is recorded by a reviewed commit that (1) adjusts the durations if needed, (2) sets
 * `status: 'APPROVED'` and (3) sets `approvedPolicyVersion` to the exact `version` approved. Until then no purge step can delete or anonymise anything.
 *
 * Real execution of ONE step needs ALL of (api/_handlers/cron/gdpr-purge.js `executionGate`):
 *   - GDPR_PURGE_ENABLED=true (the operator switch, unchanged since R33);
 *   - this policy approved: status APPROVED and approvedPolicyVersion === version;
 *   - R45 / ENG-LR-9: every OWNER CHOICE of the policy made (A7 — completed appointments: 1 year OR 2 years after startAt, R44 D4 v2, annex A) in
 *     `approvedChoices`, one of the listed options, AND named in the approved version string (« a7-365d » or « a7-730d »): the version the deployment
 *     pins therefore carries the choice, and a later change of the choice is a new version;
 *   - GDPR_PURGE_POLICY_VERSION === version (the deployment pins the version it was approved for: a later code change of a duration cannot silently run);
 *   - the step id listed in GDPR_PURGE_APPROVED_STEPS (comma separated: approval can be partial, step by step — E16);
 *   - R45 / ENG-LR-9: the step's OWN approval recorded in the policy (`approvedSteps[stepId]`: approvedOn, dryRunReviewedOn, backupVerified — the three
 *     conditions of the D4 text: a dry-run report read, a verified backup, the controller's written agreement for that step) and, for a step flagged
 *     shared-controller (structure records), the written basis agreed with the structure (`sharedControllerBasis`). The environment list alone never
 *     executes a step; the policy record alone neither;
 *   - the step is executable (report-only steps never are).
 * Otherwise the run is a DRY RUN: it counts what each step would touch and changes nothing. While an owner choice is open, the dry run counts the steps
 * that depend on it once per option (`countsByOption`), so the owner sees the effect of each option before choosing.
 *
 * No value here is a legal obligation: « Obligation légale » is stated only with a read and cited text (R43 § 3); none was identified for these durations.
 */

export const POLICY_STATUS_PROPOSED = 'PROPOSED — NOT APPROVED';
export const POLICY_STATUS_APPROVED = 'APPROVED';

/**
 * @typedef {{ days: number | null, anchor: string, basis: string, ecode?: string, ownerChoice?: string, options?: number[], pendingApproval?: string, decidedOn?: string }} PolicyDuration
 * @typedef {{ id: string, version: string, status: string, approvedPolicyVersion?: string, source: string, durations: Record<string, PolicyDuration>,
 *   ownerChoices?: Record<string, { durationKey: string, options: number[], label: string }>, approvedChoices?: Record<string, number>,
 *   approvedSteps?: Record<string, { approvedOn: string, dryRunReviewedOn: string, backupVerified: string, sharedControllerBasis?: string }>,
 *   decidedSteps?: Record<string, { decidedOn: string, decision: string, condition?: string }>, supersedes?: string }} RetentionPolicy
 */

/** @template T @param {T} o @returns {T} */
function deepFreeze(o) {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const OPS = 'besoin opérationnel (proposition)';
const CNIL_LOG = 'recommandation CNIL 2021-122 (journalisation : 6 mois à 1 an) — pas une obligation légale';
const PROOF = 'preuve (proposition, à justifier par écrit)';
const G14 = 'décision du responsable 22/11/2026, formulaire G14 (pas une obligation légale)';
const G14_X03 = 'décision du responsable 22/11/2026, formulaire G14 — applicable avec l’AIPD dédiée X03 (pas une obligation légale)';
const G14_DECISION = 'décision du responsable 22/11/2026, formulaire G14';
/**
 * G14-R3 (24/11/2026): the release-3 durations, proposed on 24/11/2026 and DECIDED by the owner the same day (Release 3 legal approval, verbatim:
 * CONTROL/master/completion/R3_OWNER_APPROVAL_2026-11-24.md; OWNER_VALIDATED — the controller's own approval, not a lawyer's or an expert's review).
 */
export const R3_DECISION = 'décision du responsable 24/11/2026, approbation juridique de la release 3 (pas une obligation légale)';
export const R3_DECIDED_ON = '2026-11-24';
/** the release-3 purge steps (delete and report) whose durations the owner decided on 24/11/2026 — decided, NOT approved (approvedSteps) */
export const R3_DECIDED_STEP_IDS = Object.freeze(['rdvConversationsDeleted', 'delegationInvitationsExpiredDeleted', 'delegationsEndedDeleted', 'guardianLinksRevokedDeleted',
  'legalProtectionStaleDeclarationsDeleted', 'legalProtectionRejectedDeleted', 'legalProtectionEndedDeleted',
  'contentReportsClosedDeleted', 'partnershipRequestsClosedDeleted', 'suspendedInstitutionAccountsReport', 'endedPartnerAgreementsReport']);
/** the X03 condition (question 27: « önerildiği gibi, ayrı AIPD ile birlikte ») */
export const X03_AIPD_CONDITION = 'AIPD dédiée X03 signée';

/**
 * G14 — the decision recorded per expansion step: { decidedOn, decision (the question), condition? }. A decided step is NOT an approved step: it executes
 * only once the controller records it in `approvedSteps` (dry run read, backup verified) and lists it in GDPR_PURGE_APPROVED_STEPS.
 * @type {Record<string, { decidedOn: string, decision: string, condition?: string }>}
 */
const G14_DECIDED_STEPS = Object.fromEntries([
  ['eventNeedsClearedAfterEnd', 14], ['eventRegistrationsDeleted', 15], ['academyEventsEndedDeleted', 16],
  ['testimonialsPendingExpired', 17], ['testimonialSkeletonsDeleted', 19], ['testimonialReportsDeleted', 20], ['testimonialsReconfirmationReport', 18],
  ['storiesPendingExpired', 17], ['storySkeletonsDeleted', 19], ['storyReportsDeleted', 20], ['storiesReconfirmationReport', 18], ['communityMembersInactiveDeleted', 21],
  ['jobListingsExpiredMarked', 25], ['jobListingApplyTargetsErased', 23], ['jobListingsEndedDeleted', 25], ['jobListingDraftsDeleted', 25],
  ['entraideOffersIdleClosed', 27], ['entraideRequestsPendingExpired', 27], ['entraideRequestsAcceptedEnded', 26], ['entraideRequestsEndedDeleted', 27],
  ['entraideOffersClosedDeleted', 27], ['entraideReportsDeleted', 27], ['entraideSuspensionsReview', 27], ['entraideMembersInactiveDeleted', 27],
  ['contentNoticesDeleted', 28],
].map(([id, q]) => [id, { decidedOn: '2026-11-22', decision: `${G14_DECISION}, question ${q}`,
  ...(String(id).startsWith('entraide') ? { condition: X03_AIPD_CONDITION } : {}) }]));
/** G14 (décision du responsable 23/11/2026, options recommandées) — moderation decisions, appeals and sanctions: 1 year after the case is closed */
export const G14_MODERATION_DECISION = 'décision du responsable 23/11/2026, options recommandées (décisions de modération, contestations et mesures)';
/**
 * G14-PS — the social referral (migration 0061): a closed referral is erased 12 months after its closure. Proposed on 23/11/2026, DECIDED by the owner on
 * 23/11/2026 (G14 legal approval, « à valider » point 4: CONTROL/master/G14_OWNER_LEGAL_APPROVAL_2026-11-23.md). Like the other decided steps it is not an
 * approved step: it executes only once the controller records it in `approvedSteps` (dry run read, backup verified) and lists it in
 * GDPR_PURGE_APPROVED_STEPS.
 */
export const SOCIAL_REFERRAL_STEP_ID = 'socialReferralsClosedDeleted';
export const G14_SOCIAL_REFERRAL_DECISION = 'décision du responsable 23/11/2026, approbation juridique G14 (orientations sociales : 12 mois après la clôture)';
const G14_DECIDED_STEPS_23 = Object.fromEntries(['moderationDecisionsDeleted', 'moderationSanctionsDeleted']
  .map((id) => [id, { decidedOn: '2026-11-23', decision: G14_MODERATION_DECISION }]));
G14_DECIDED_STEPS_23[SOCIAL_REFERRAL_STEP_ID] = { decidedOn: '2026-11-23', decision: G14_SOCIAL_REFERRAL_DECISION };
/**
 * G14-R3 (décision du responsable 24/11/2026): each release-3 step is a DECIDED step — not an approved one. The owner's own words: « silme adımları ancak
 * dry-run okunduktan ve yedek doğrulandıktan sonra adım adım açılır » (each deletion step opens only after its dry run is read and a backup verified):
 * it executes only once the controller records it in `approvedSteps` and the operator lists it in GDPR_PURGE_APPROVED_STEPS.
 */
const R3_DECIDED_STEPS = Object.fromEntries(R3_DECIDED_STEP_IDS.map((id) => [id, { decidedOn: R3_DECIDED_ON, decision: R3_DECISION }]));

/** @type {RetentionPolicy} */
export const RETENTION_POLICY = deepFreeze({
  id: 'ada-retention-policy',
  // V2 phase 1 (owner, 09/11/2026): the controller APPROVED the retention policy directions of the review package (candidate e227df1, MANIFEST.json:
  // D4 V2 with its 09/11 addenda) — proposal r45-proposal-2-2026-11-05, durations unchanged, owner choice A7 = 365 days. This is the approval of the
  // policy directions, NOT the final AIPD signature. No purge step executes from this alone: each step still needs its own approval record below
  // (approvedSteps), GDPR_PURGE_ENABLED, GDPR_PURGE_POLICY_VERSION = this version, and GDPR_PURGE_APPROVED_STEPS (executionGate).
  // G14 (décision du responsable 22/11/2026, formulaire G14, questions 14–28 et 32): a NEW version carrying the expansion durations (X01–X05, content
  // notices). Question 32 « (önerilen) »: the new version is approved AND step 6c re-approved in ONE move — the version below replaces
  // r45-proposal-2-2026-11-05-a7-365d (still named in `supersedes`); the deployment must re-pin GDPR_PURGE_POLICY_VERSION to it in the same owner action,
  // otherwise every run (6c included) is a dry run (POLICY_VERSION_NOT_PINNED, fail-closed). Durations of the earlier version are unchanged; A7 = 365.
  // G14 (décision du responsable 23/11/2026, options recommandées): one more duration (MODERATION_CASE_CLOSED_DAYS, decisions / appeals / sanctions 1 year
  // after the case is closed) → a NEW version g14-expansion-2-2026-11-23-a7-365d (g14-expansion-1-2026-11-22-a7-365d was never deployed); the deployment
  // pins GDPR_PURGE_POLICY_VERSION to it. Every other duration unchanged.
  // G14-R3 (décision du responsable 24/11/2026, approbation juridique de la release 3): the eleven release-3 durations (C23 trusted persons, C05 guardian
  // links, protected adults, E9 appointment conversations, content reports, partnership requests, institution accounts, partner conventions) are decided
  // → a NEW version g14-r3-2026-11-24-a7-365d. The deployment must re-pin GDPR_PURGE_POLICY_VERSION to it BEFORE the release-3 code runs in Production,
  // otherwise every run (6c included) is a dry run (POLICY_VERSION_NOT_PINNED, fail-closed). Every other duration unchanged; A7 = 365.
  version: 'g14-r3-2026-11-24-a7-365d',
  supersedes: 'r45-proposal-2-2026-11-05-a7-365d',
  status: POLICY_STATUS_APPROVED,
  approvedPolicyVersion: 'g14-r3-2026-11-24-a7-365d',
  approvedChoices: { A7: 365 },
  // approvedSteps: one entry per step the controller approved (D4: step by step) — { [stepId]: { approvedOn, dryRunReviewedOn, backupVerified,
  //   sharedControllerBasis? } }. C3 step 6c ONLY (V2 stage 6B): unverified accounts deleted after 7 days. Dry run opened in Production 14/11/2026
  //   (owner approval of CONTROL/v2/C3_6C_PAKETI_TR.md); first dry-run report reviewed 14/11; verified backup = C7 restore evidence 12/11 + K3 scheduled
  //   backups accepted 13/11. This record executes nothing alone: GDPR_PURGE_ENABLED, GDPR_PURGE_POLICY_VERSION and GDPR_PURGE_APPROVED_STEPS are set
  //   only by the owner's 6B sentence. No other step is approved (steps 6 and 6b need their own dry run and approval).
  approvedSteps: {
    unverifiedAccountsDeleted: {
      approvedOn: '2026-11-14',
      dryRunReviewedOn: '2026-11-14',
      backupVerified: 'CONTROL/v2/c7/EVIDENCE_2026-11-12.json (restore verified) + K3 scheduled backups 2026-11-13T02:20Z/14:17Z (ADAB2, EU)',
    },
  },
  // G14 — the DURATIONS of the expansion steps are decided by the controller (décision du responsable 22/11/2026, formulaire G14). That is not the
  // per-step approval above: D4 still requires, for each step, a dry-run report READ and a VERIFIED backup before it executes, and neither exists yet for
  // these steps (engineering never invents them). `decidedSteps` records the decision per step; the controller adds the step to `approvedSteps` after
  // reading its dry run. X03 steps carry a condition: the dedicated X03 AIPD must be signed first (question 27).
  decidedSteps: { ...G14_DECIDED_STEPS, ...G14_DECIDED_STEPS_23, ...R3_DECIDED_STEPS },
  source: 'R43_DOSSIER_RGPD_ACTIVATION_FR.md § 3.1 — [PROPOSITION — À VALIDER RT]; R44_DECISIONS_RGPD_D1_D6_FR_v2.md annexe A (A7 au choix du responsable); G14_KARAR_FORMU_GENISLETME_TR.md (décision du responsable 22/11/2026, questions 14–28, 32)',
  ownerChoices: {
    A7: { durationKey: 'APPOINTMENT_CONFIRMED_DAYS', options: [365, 730], label: 'rendez-vous confirmés, tenus, absences : 1 an ou 2 ans après startAt (D4 v2, annexe A, ligne A7)' },
  },
  durations: {
    ENTITY_VERSION_DAYS: { days: 90, anchor: 'createdAt (superseded versions only)', basis: OPS },
    UPDATE_LOG_DAYS: { days: 90, anchor: 'ran_at', basis: OPS },
    AUDIT_LOG_DAYS: { days: 365, anchor: 'timestamp', basis: CNIL_LOG, ecode: 'E13' },
    CONVERSATION_LOG_DAYS: { days: 90, anchor: 'createdAt', basis: OPS },
    SHARED_DIAGNOSTIC_MAX_DAYS: { days: 90, anchor: 'createdAt (or expiresAt passed)', basis: OPS, ecode: 'E11' },
    AI_METRIC_DAYS: { days: 90, anchor: 'createdAt', basis: OPS },
    CONSENT_SUPERSEDED_DAYS: { days: 1095, anchor: 'created_at (superseded decisions only)', basis: PROOF, ecode: 'E10' },
    CONSENT_AFTER_ERASURE_DAYS: { days: 365, anchor: 'DSRRequest.completedAt of the erasure', basis: PROOF, ecode: 'E10' },
    INVITATION_GRACE_DAYS: { days: 30, anchor: 'expires_at', basis: OPS },
    OUTLOOK_TOKEN_GRACE_DAYS: { days: 30, anchor: 'expiresAt', basis: OPS },
    PRO_AUDIT_LOG_DAYS: { days: 365, anchor: 'createdAt', basis: CNIL_LOG, ecode: 'E13' },
    // R45: A7 is an OWNER CHOICE (R44 D4 v2): 365 (the most minimising: the platform organises access, it does not accompany) or 730 (the CNIL
    // reference for social accompaniment). No default: `days` stays null until approvedChoices.A7 is set by the controller's decision.
    APPOINTMENT_CONFIRMED_DAYS: { days: null, ownerChoice: 'A7', options: [365, 730], anchor: 'startAt (date of the appointment)', basis: OPS, ecode: 'E1' },
    APPOINTMENT_UNCONFIRMED_DAYS: { days: 90, anchor: 'startAt', basis: OPS, ecode: 'E3' },
    APPOINTMENT_CANCELLED_DAYS: { days: 90, anchor: 'COALESCE(cancelledAt, startAt)', basis: OPS, ecode: 'E3' },
    APPOINTMENT_MESSAGE_DAYS: { days: 30, anchor: 'startAt, or LEAST(startAt, cancelledAt) when cancelled', basis: OPS, ecode: 'E5' },
    GUEST_HOLD_DAYS: { days: 1, anchor: 'guestHoldExpiresAt (0043+ only)', basis: OPS, ecode: 'E12' },
    PRO_NOTIFICATION_DAYS: { days: 180, anchor: 'createdAt', basis: OPS, ecode: 'E8' },
    PUSH_FAILING_DAYS: { days: 30, anchor: 'lastFailureAt (status FAILING)', basis: OPS, ecode: 'E8' },
    RDV_CONVERSATION_DAYS: { days: 730, anchor: 'COALESCE(lastMessageAt, createdAt), or the anonymisation of the appointment', basis: R3_DECISION, ecode: 'E9', decidedOn: R3_DECIDED_ON },
    LEGAL_HOLD_RELEASED_DAYS: { days: 365, anchor: 'releasedAt', basis: PROOF, ecode: 'E9b' },
    SUPPORT_REQUEST_DAYS: { days: 365, anchor: 'closedAt', basis: OPS, ecode: 'E9b' },
    DSR_REQUEST_DAYS: { days: 1095, anchor: 'completedAt', basis: PROOF, ecode: 'E9b' },
    INACTIVE_ACCOUNT_DAYS: { days: 730, anchor: 'COALESCE(CitizenUser.lastSeenAt, createdAt) — last sign-in, or creation if never signed in', basis: OPS, ecode: 'E7' },
    UNVERIFIED_ACCOUNT_DAYS: { days: 7, anchor: 'CitizenUser.createdAt of an account whose address was never confirmed (emailVerifiedAt IS NULL)', basis: OPS, ecode: 'D4-V2' },
    MAIL_SUPPRESSION_REVIEW_DAYS: { days: 365, anchor: 'timestamp of the active « mail.suppressed » row (review, never automatic deletion)', basis: OPS, ecode: 'D4-V2' },
    INACTIVE_WARNING_GRACE_DAYS: { days: 30, anchor: 'warning e-mail sent (not built)', basis: OPS, ecode: 'E7' },
    PRO_USER_DISABLED_DAYS: { days: 365, anchor: 'disabling date (not recorded on 0042)', basis: OPS, ecode: 'E9b' },
    BACKUP_KEEP_DAYS: { days: 35, anchor: 'backup file time (V2: 35 days, as the privacy notice § 4 says)', basis: OPS, ecode: 'E15' },
    // G14 — Mon Parcours: 24 months after closure. DECIDED by the controller on 22/11/2026 (« G14 toplu onay », point 2: « décision du responsable
    // 22/11/2026 », CONTROL/master/MASTER_CHECKPOINT.md; analyse documentaire Q7: a management choice). The duration is decided; the purge STEP still needs
    // its own record in approvedSteps (dry run of this step read, verified backup) and GDPR_PURGE_APPROVED_STEPS, like every other step — not given here.
    PARCOURS_CLOSED_STEP_DAYS: { days: 730, anchor: 'closing date of the step (latest change of state in its history, else updatedAt); its history and reminder ledger go with it', basis: 'choix de gestion — décision du responsable 22/11/2026', ecode: 'G14', decidedOn: '2026-11-22' },
    // ── G14 expansion (décision du responsable 22/11/2026, formulaire G14; the question number follows each line). None is a legal obligation.
    EVENT_NEED_AFTER_END_DAYS: { days: 1, anchor: 'AcademyItem.endsAt (accessibility need of a registration)', basis: G14, ecode: 'X04' },   // q14
    EVENT_REGISTRATION_AFTER_END_DAYS: { days: 30, anchor: 'AcademyItem.endsAt, or LEAST(cancelledAt, endsAt) when cancelled', basis: G14, ecode: 'X04' },   // q15
    ACADEMY_EVENT_ENDED_DAYS: { days: 365, anchor: 'COALESCE(AcademyItem.endsAt, cancelledAt) of an EVENT', basis: G14, ecode: 'X04' },   // q16
    TESTIMONIAL_PENDING_DAYS: { days: 60, anchor: 'Testimonial.submittedAt (never read by a moderator)', basis: G14, ecode: 'X02' },   // q17
    TESTIMONIAL_REVIEW_DAYS: { days: 1095, anchor: 'Testimonial.publishedAt (report only: the person is asked again)', basis: G14, ecode: 'X02' },   // q18
    TESTIMONIAL_SKELETON_DAYS: { days: 365, anchor: 'COALESCE(withdrawnAt, moderatedAt, updatedAt) of a row without text', basis: G14, ecode: 'X02' },   // q19
    UGC_REPORT_DAYS: { days: 90, anchor: 'createdAt of an in-app report (deleted at the decision already)', basis: G14, ecode: 'X02' },   // q20
    STORY_PENDING_DAYS: { days: 60, anchor: 'CommunityStory.submittedAt', basis: G14, ecode: 'X01' },   // q17
    STORY_REVIEW_DAYS: { days: 1095, anchor: 'CommunityStory.publishedAt (report only)', basis: G14, ecode: 'X01' },   // q18
    STORY_SKELETON_DAYS: { days: 365, anchor: 'COALESCE(withdrawnAt, moderatedAt, updatedAt) of a row without text', basis: G14, ecode: 'X01' },   // q19
    COMMUNITY_MEMBER_INACTIVE_DAYS: { days: 730, anchor: 'GREATEST(member.createdAt, MAX(story.updatedAt)) of a pseudonym without a pending or published story', basis: G14, ecode: 'X01' },   // q21
    JOB_APPLY_TARGET_AFTER_END_DAYS: { days: 30, anchor: 'expiresOn (expired), withdrawnAt (withdrawn), moderatedAt (taken down)', basis: G14, ecode: 'X05' },   // q23
    JOB_LISTING_ENDED_DAYS: { days: 365, anchor: 'same anchors as JOB_APPLY_TARGET_AFTER_END_DAYS', basis: G14, ecode: 'X05' },   // q25
    JOB_LISTING_DRAFT_DAYS: { days: 180, anchor: 'JobListing.updatedAt of a draft or a rejected listing', basis: G14, ecode: 'X05' },   // q25
    ENTRAIDE_OFFER_IDLE_DAYS: { days: 90, anchor: 'EntraideOffer.updatedAt (open / paused)', basis: G14_X03, ecode: 'X03' },   // q27
    ENTRAIDE_REQUEST_PENDING_DAYS: { days: 30, anchor: 'EntraideRequest.createdAt', basis: G14_X03, ecode: 'X03' },   // q27
    ENTRAIDE_REQUEST_ACCEPTED_DAYS: { days: 90, anchor: 'COALESCE(decidedAt, updatedAt) of an accepted request', basis: G14_X03, ecode: 'X03' },   // q26
    ENTRAIDE_REQUEST_ENDED_DAYS: { days: 365, anchor: 'EntraideRequest.closedAt', basis: G14_X03, ecode: 'X03' },   // q27
    ENTRAIDE_OFFER_CLOSED_DAYS: { days: 365, anchor: 'EntraideOffer.closedAt', basis: G14_X03, ecode: 'X03' },   // q27
    ENTRAIDE_REPORT_DAYS: { days: 365, anchor: 'EntraideReport.createdAt', basis: G14_X03, ecode: 'X03' },   // q27
    ENTRAIDE_SUSPENSION_REVIEW_DAYS: { days: 365, anchor: 'EntraideMember.suspendedAt (report only: human review)', basis: G14_X03, ecode: 'X03' },   // q27
    ENTRAIDE_MEMBER_INACTIVE_DAYS: { days: 730, anchor: 'GREATEST(member.updatedAt, MAX(offer.updatedAt), MAX(request.updatedAt))', basis: G14_X03, ecode: 'X03' },   // q27
    CONTENT_NOTICE_AFTER_DECISION_DAYS: { days: 365, anchor: 'ContentNotice.decidedAt (notice sent through the public form, without an account)', basis: G14, ecode: 'DSA' },   // q28
    // G14-PS (décision du responsable 23/11/2026) — a closed social referral and its history, 12 months after closedAt (declined, completed, cancelled,
    // withdrawn, expired, closed). The consent rows stay under CONSENT_SUPERSEDED_DAYS / CONSENT_AFTER_ERASURE_DAYS.
    SOCIAL_REFERRAL_CLOSED_DAYS: { days: 365, anchor: 'SocialReferral.closedAt (any terminal state); its SocialReferralEvent rows go with it', basis: 'décision du responsable 23/11/2026 (pas une obligation légale)', ecode: 'G14-PS', decidedOn: '2026-11-23' },
    // G14 (décision du responsable 23/11/2026): a moderation case is closed when nothing can change it any more — a decision: its appeal period is over, no
    // appeal is open, its restriction has ended (GREATEST(appealUntil, restrictionEndsAt, last appeal reviewedAt)); a sanction: it no longer counts
    // (a warning: 12 months after it was given, WARNING_WINDOW_DAYS; a suspension: its end), or it was lifted, whichever comes first. Its appeals go with it.
    MODERATION_CASE_CLOSED_DAYS: { days: 365, anchor: 'closing of the case: decision GREATEST(appealUntil, restrictionEndsAt, MAX(appeal.reviewedAt)) with no open appeal; sanction LEAST(liftedAt, endsAt or createdAt + 365 days)', basis: 'décision du responsable 23/11/2026 (pas une obligation légale)', ecode: 'DSA', decidedOn: '2026-11-23' },
    // G14-R3 (release-3 package, 24/11/2026) — DECIDED by the owner on 24/11/2026 (R3_DECISION): the trusted persons (C23) and the guardian links (C05)
    // had no duration of their own (they lived until the account was erased). Decided is not approved: each step still needs its own approvedSteps record
    // (dry run read, backup verified) and GDPR_PURGE_APPROVED_STEPS before it executes.
    // The household (C03) needs none: it is kept while the person keeps it, deleted by the person at any time and with the account (ON DELETE CASCADE).
    DELEGATION_INVITATION_EXPIRED_DAYS: { days: 30, anchor: 'CitizenDelegation.inviteExpiresAt of an invitation never answered (status INVITED): the invited e-mail address goes with the row', basis: R3_DECISION, ecode: 'C23', decidedOn: R3_DECIDED_ON },
    DELEGATION_ENDED_DAYS: { days: 365, anchor: 'COALESCE(endedAt, expiresAt) of a delegation ended (REVOKED, DECLINED) or expired; its view log (DelegationAccessEvent) goes with it (ON DELETE CASCADE)', basis: R3_DECISION, ecode: 'C23', decidedOn: R3_DECIDED_ON },
    GUARDIAN_LINK_REVOKED_DAYS: { days: 30, anchor: 'GuardianRelationship.updatedAt of a REVOKED link (the proof of each step stays in the consent ledger under its own rule)', basis: R3_DECISION, ecode: 'C05', decidedOn: R3_DECIDED_ON },
    // G14-R3G (24/11/2026) — the representative of a protected adult (LegalProtectionMandate, migration 0064). DECIDED 24/11/2026 (R3_DECISION): the row
    // holds only facts extracted from the court decision (never the decision); the history of views and actions stays in AuditLog under its own rule.
    //   DECLARED_STALE  a declaration the administrator never verified (the representative never showed the decision): 90 days after it was made
    //   REJECTED        a refused declaration (shown to the person, who may need it to report a false declaration): 90 days after the refusal
    //   ENDED           a link renounced, ended by the administrator or expired (validUntil passed): 365 days after its end — what was done under it
    //                   stays provable for the person for a year, as for the trusted persons
    LEGAL_PROTECTION_DECLARED_STALE_DAYS: { days: 90, anchor: 'LegalProtectionMandate.createdAt of a declaration still DECLARED (never verified)', basis: R3_DECISION, ecode: 'C23', decidedOn: R3_DECIDED_ON },
    LEGAL_PROTECTION_REJECTED_DAYS: { days: 90, anchor: 'LegalProtectionMandate.endedAt of a REJECTED declaration', basis: R3_DECISION, ecode: 'C23', decidedOn: R3_DECIDED_ON },
    LEGAL_PROTECTION_ENDED_DAYS: { days: 365, anchor: 'COALESCE(endedAt, validUntil) of a link ENDED, or VERIFIED / SUSPENDED past validUntil (expired)', basis: R3_DECISION, ecode: 'C23', decidedOn: R3_DECIDED_ON },
    // G14-R3 follow-up (24/11/2026, same release-3 package) — DECIDED 24/11/2026 (R3_DECISION; not approved steps): the records of the communications
    // forms, of the institution space and of the partner conventions had no duration (agents' audit, CONTROL/master/completion/R3_KURUM_MESAJ_KOPRU.md § 3.6).
    //   CONTENT_REPORT_CLOSED  a content report (« Signaler une erreur » on a public page, and the in-thread « Signaler » of a message: R3) once handled
    //                          (FIXED or REJECTED): 12 months after its last change — the reporter's optional e-mail goes with it
    //   PARTNERSHIP_REQUEST    a « Proposer une structure » / partnership request once answered (status other than « pending »): 12 months after its last change
    //   INSTITUTION_SUSPENDED  REPORT ONLY: an institution account SUSPENDED (convention ended, or suspended by an administrator) — no suspension date is
    //                          recorded (anchor: last sign-in, else creation); deleting it is an administrator's decision with the institution
    //   PARTNER_AGREEMENT_ENDED REPORT ONLY: an ENDED convention, 5 years after endedAt (proof of what was agreed — owner decision, no legal text read); an
    //                          account still references it (InstitutionAccount.agreementId, ON DELETE RESTRICT): never deleted by this job
    CONTENT_REPORT_CLOSED_DAYS: { days: 365, anchor: 'ContentReport.updatedAt of a report FIXED or REJECTED', basis: R3_DECISION, ecode: 'R3-COM', decidedOn: R3_DECIDED_ON },
    PARTNERSHIP_REQUEST_CLOSED_DAYS: { days: 365, anchor: 'PartnershipRequest.updatedAt of a request whose status is not « pending »', basis: R3_DECISION, ecode: 'R3-COM', decidedOn: R3_DECIDED_ON },
    INSTITUTION_ACCOUNT_SUSPENDED_DAYS: { days: 365, anchor: 'COALESCE(lastLogin, createdAt) of an InstitutionAccount SUSPENDED (no suspension date recorded) — report only', basis: R3_DECISION, ecode: 'R3-INST', decidedOn: R3_DECIDED_ON },
    PARTNER_AGREEMENT_ENDED_DAYS: { days: 1825, anchor: 'PartnerAgreement.endedAt of an ENDED convention — report only', basis: R3_DECISION, ecode: 'R3-INST', decidedOn: R3_DECIDED_ON },
    BACKUP_KEEP_WEEKLY: { days: 0, anchor: 'number of weekly backups kept beyond BACKUP_KEEP_DAYS (a count, not days; V2: none — nothing older than 35 days)', basis: OPS, ecode: 'E15' },
  },
});

export const OWNER_CHOICE_REQUIRED = 'OWNER_CHOICE_REQUIRED';

/** the chosen value of an owner choice, or null when not made / not one of the options @param {RetentionPolicy} policy @param {string} choiceId */
export function ownerChoiceValue(policy, choiceId) {
  const c = /** @type {any} */ (policy)?.ownerChoices?.[choiceId];
  const v = /** @type {any} */ (policy)?.approvedChoices?.[choiceId];
  return c && Array.isArray(c.options) && Number.isInteger(v) && c.options.includes(v) ? v : null;
}

/** keys that are counts, where 0 is a valid value */
const ZERO_ALLOWED = new Set(['BACKUP_KEEP_WEEKLY']);

/**
 * The number of days of a policy duration (throws on an unknown key: a step can never run with an undefined duration). R45: a duration that is an owner
 * choice (A7) throws OWNER_CHOICE_REQUIRED until the choice is made — `opts.option` evaluates one option for a dry run only.
 * @param {RetentionPolicy} policy @param {string} key @param {{ option?: number }} [opts]
 */
export function policyDays(policy, key, opts = {}) {
  const d = /** @type {any} */ (policy?.durations?.[key]);
  if (d && d.ownerChoice) {
    if (opts.option !== undefined) {
      if (!Array.isArray(d.options) || !d.options.includes(opts.option)) throw new Error(`retention policy ${policy?.version}: ${opts.option} is not an option of ${key}`);
      return opts.option;
    }
    const v = ownerChoiceValue(policy, d.ownerChoice);
    if (v === null) throw Object.assign(new Error(`retention policy ${policy?.version}: ${key} is owner choice ${d.ownerChoice} (${(d.options || []).join(' or ')} days), not made`), { code: OWNER_CHOICE_REQUIRED, choice: d.ownerChoice, options: d.options });
    return v;
  }
  // V2: a COUNT may be 0 (BACKUP_KEEP_WEEKLY: no weekly copy beyond BACKUP_KEEP_DAYS); a duration in days never is
  if (!d || !Number.isInteger(d.days) || d.days < 0 || (d.days === 0 && !ZERO_ALLOWED.has(key))) throw new Error(`retention policy ${policy?.version}: no duration ${key}`);
  return d.days;
}

/** the owner choice behind a duration key, or null @param {RetentionPolicy} policy @param {string | null} key @returns {{ id: string, options: number[] } | null} */
export function ownerChoiceOf(policy, key) {
  const d = /** @type {any} */ (key ? policy?.durations?.[key] : null);
  return d && d.ownerChoice ? { id: d.ownerChoice, options: [...(d.options || [])] } : null;
}

/** the version tag that must name a made choice (« a7-365d ») @param {string} choiceId @param {number} days */
export const choiceTag = (choiceId, days) => `${choiceId.toLowerCase()}-${days}d`;

/** owner choices not made, or made but not named in the version string @param {RetentionPolicy} policy @returns {string[]} */
export function missingOwnerChoices(policy) {
  const choices = /** @type {any} */ (policy)?.ownerChoices || {};
  return Object.keys(choices).filter((id) => {
    const v = ownerChoiceValue(policy, id);
    return v === null || !String(policy?.version || '').split(/[^a-z0-9]+/i).join('-').toLowerCase().includes(choiceTag(id, v));
  });
}

/** The policy records the controller's approval of THIS version, owner choices included (R45: A7). @param {RetentionPolicy} policy */
export function isPolicyApproved(policy) {
  return Boolean(policy) && policy.status === POLICY_STATUS_APPROVED && typeof policy.approvedPolicyVersion === 'string'
    && policy.approvedPolicyVersion.length > 0 && policy.approvedPolicyVersion === policy.version && missingOwnerChoices(policy).length === 0;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * R45 / ENG-LR-9 — the controller's own approval of ONE step, recorded in the policy (the environment list GDPR_PURGE_APPROVED_STEPS is the operator's
 * activation, not the approval). Returns null when complete, else why not. @param {RetentionPolicy} policy @param {{ id: string, sharedController?: string }} step
 */
export function stepApprovalProblem(policy, step) {
  // G14: a duration still marked « à approuver » never executes, whatever the step record and the environment say
  const dk = /** @type {any} */ (step).durationKey;
  if (dk && /** @type {any} */ (policy)?.durations?.[dk]?.pendingApproval) return 'DURATION_PENDING_APPROVAL';
  const a = /** @type {any} */ (policy)?.approvedSteps?.[step.id];
  if (!a || typeof a !== 'object') return 'STEP_NOT_APPROVED_IN_POLICY';
  if (!ISO_DAY.test(String(a.approvedOn || ''))) return 'STEP_APPROVAL_DATE_MISSING';
  if (!ISO_DAY.test(String(a.dryRunReviewedOn || ''))) return 'STEP_DRY_RUN_REVIEW_MISSING';
  if (String(a.dryRunReviewedOn) > String(a.approvedOn)) return 'STEP_DRY_RUN_REVIEW_AFTER_APPROVAL';
  if (typeof a.backupVerified !== 'string' || a.backupVerified.trim().length < 3) return 'STEP_BACKUP_VERIFICATION_MISSING';
  if (step.sharedController && (typeof a.sharedControllerBasis !== 'string' || a.sharedControllerBasis.trim().length < 3)) return 'STEP_SHARED_CONTROLLER_BASIS_MISSING';
  // G14: a decided step with an open condition (X03 — the dedicated AIPD) never executes, whatever its approval record says
  const decided = /** @type {any} */ (policy)?.decidedSteps?.[step.id];
  if (decided?.condition && !ISO_DAY.test(String(decided.conditionMetOn || ''))) return 'STEP_CONDITION_OPEN';
  return null;
}

/** The step ids of GDPR_PURGE_APPROVED_STEPS (comma or space separated; no wildcard). @param {Record<string, string | undefined>} env */
export function approvedStepsFromEnv(env) {
  return new Set(String(env.GDPR_PURGE_APPROVED_STEPS || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0 && s !== '*'));
}

/**
 * Whether real execution is allowed at all for this run, and why not. Per-step approval is checked by the caller with `approvedSteps`.
 * @param {RetentionPolicy} policy @param {Record<string, string | undefined>} env @param {{ dryRunRequested?: boolean }} [opts]
 * @returns {{ execute: boolean, reason: string | null, approvedSteps: Set<string> }}
 */
export function executionGate(policy, env, opts = {}) {
  const approvedSteps = approvedStepsFromEnv(env);
  const no = (/** @type {string} */ reason) => ({ execute: false, reason, approvedSteps });
  if (String(env.GDPR_PURGE_ENABLED || '').trim().toLowerCase() !== 'true') return no('GDPR_PURGE_DISABLED');
  if (opts.dryRunRequested) return no('DRY_RUN_REQUESTED');
  if (policy?.status === POLICY_STATUS_APPROVED && policy.approvedPolicyVersion === policy.version && missingOwnerChoices(policy).length > 0) return no('OWNER_CHOICE_MISSING');
  if (!isPolicyApproved(policy)) return no('POLICY_NOT_APPROVED');
  if (String(env.GDPR_PURGE_POLICY_VERSION || '').trim() !== policy.version) return no('POLICY_VERSION_NOT_PINNED');
  if (approvedSteps.size === 0) return no('NO_APPROVED_STEPS');
  return { execute: true, reason: null, approvedSteps };
}

/**
 * G14 — will a purge step really execute in this environment (policy approved and pinned, purge enabled, the step listed AND recorded, its duration not
 * pending)? Used to announce a deletion to a person only when it will happen (api/_services/citizen-inbox.js).
 * @param {RetentionPolicy} policy @param {Record<string, string | undefined>} env @param {{ id: string, durationKey: string, sharedController?: string }} step
 */
export function stepWillExecute(policy, env, step) {
  const gate = executionGate(policy, env);
  return gate.execute && gate.approvedSteps.has(step.id) && stepApprovalProblem(policy, step) === null;
}

/** A public summary of a policy (no secret, no personal data). @param {RetentionPolicy} policy */
export function policySummary(policy) {
  return { id: policy.id, version: policy.version, status: policy.status, approved: isPolicyApproved(policy), approvedPolicyVersion: policy.approvedPolicyVersion ?? null, source: policy.source,
    ownerChoicesOpen: missingOwnerChoices(policy), approvedChoices: /** @type {any} */ (policy).approvedChoices ?? null,
    approvedStepCount: Object.keys(/** @type {any} */ (policy).approvedSteps || {}).length,
    decidedStepCount: Object.keys(/** @type {any} */ (policy).decidedSteps || {}).length };
}

/**
 * G14 — the decision behind a step, or null. A step with a condition (X03: the dedicated AIPD) stays non-approvable while the condition is open: even an
 * approvedSteps record does not execute it until the condition is recorded as met (`conditionMetOn`). @param {RetentionPolicy} policy @param {string} stepId
 */
export function stepDecision(policy, stepId) {
  const d = /** @type {any} */ (policy)?.decidedSteps?.[stepId];
  return d && typeof d === 'object' ? d : null;
}
