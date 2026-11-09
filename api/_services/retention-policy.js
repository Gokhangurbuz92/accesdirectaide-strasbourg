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
 * @typedef {{ days: number | null, anchor: string, basis: string, ecode?: string, ownerChoice?: string, options?: number[] }} PolicyDuration
 * @typedef {{ id: string, version: string, status: string, approvedPolicyVersion?: string, source: string, durations: Record<string, PolicyDuration>,
 *   ownerChoices?: Record<string, { durationKey: string, options: number[], label: string }>, approvedChoices?: Record<string, number>,
 *   approvedSteps?: Record<string, { approvedOn: string, dryRunReviewedOn: string, backupVerified: string, sharedControllerBasis?: string }> }} RetentionPolicy
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

/** @type {RetentionPolicy} */
export const RETENTION_POLICY = deepFreeze({
  id: 'ada-retention-policy',
  // V2 phase 1 (owner, 09/11/2026): the controller APPROVED the retention policy directions of the review package (candidate e227df1, MANIFEST.json:
  // D4 V2 with its 09/11 addenda) — proposal r45-proposal-2-2026-11-05, durations unchanged, owner choice A7 = 365 days. This is the approval of the
  // policy directions, NOT the final AIPD signature. No purge step executes from this alone: each step still needs its own approval record below
  // (approvedSteps), GDPR_PURGE_ENABLED, GDPR_PURGE_POLICY_VERSION = this version, and GDPR_PURGE_APPROVED_STEPS (executionGate).
  version: 'r45-proposal-2-2026-11-05-a7-365d',
  status: POLICY_STATUS_APPROVED,
  approvedPolicyVersion: 'r45-proposal-2-2026-11-05-a7-365d',
  approvedChoices: { A7: 365 },
  // approvedSteps: ABSENT on purpose — { [stepId]: { approvedOn: 'YYYY-MM-DD', dryRunReviewedOn: 'YYYY-MM-DD', backupVerified: '<backup name or evidence ref>',
  //   sharedControllerBasis?: '<written agreement with the structure>' } }, one entry per step the controller approved (D4: step by step)
  source: 'R43_DOSSIER_RGPD_ACTIVATION_FR.md § 3.1 — [PROPOSITION — À VALIDER RT]; R44_DECISIONS_RGPD_D1_D6_FR_v2.md annexe A (A7 au choix du responsable)',
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
    RDV_CONVERSATION_DAYS: { days: 730, anchor: 'COALESCE(lastMessageAt, createdAt), or the anonymisation of the appointment', basis: OPS, ecode: 'E9' },
    LEGAL_HOLD_RELEASED_DAYS: { days: 365, anchor: 'releasedAt', basis: PROOF, ecode: 'E9b' },
    SUPPORT_REQUEST_DAYS: { days: 365, anchor: 'closedAt', basis: OPS, ecode: 'E9b' },
    DSR_REQUEST_DAYS: { days: 1095, anchor: 'completedAt', basis: PROOF, ecode: 'E9b' },
    INACTIVE_ACCOUNT_DAYS: { days: 730, anchor: 'COALESCE(CitizenUser.lastSeenAt, createdAt) — last sign-in, or creation if never signed in', basis: OPS, ecode: 'E7' },
    UNVERIFIED_ACCOUNT_DAYS: { days: 7, anchor: 'CitizenUser.createdAt of an account whose address was never confirmed (emailVerifiedAt IS NULL)', basis: OPS, ecode: 'D4-V2' },
    MAIL_SUPPRESSION_REVIEW_DAYS: { days: 365, anchor: 'timestamp of the active « mail.suppressed » row (review, never automatic deletion)', basis: OPS, ecode: 'D4-V2' },
    INACTIVE_WARNING_GRACE_DAYS: { days: 30, anchor: 'warning e-mail sent (not built)', basis: OPS, ecode: 'E7' },
    PRO_USER_DISABLED_DAYS: { days: 365, anchor: 'disabling date (not recorded on 0042)', basis: OPS, ecode: 'E9b' },
    BACKUP_KEEP_DAYS: { days: 35, anchor: 'backup file time (V2: 35 days, as the privacy notice § 4 says)', basis: OPS, ecode: 'E15' },
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
  const a = /** @type {any} */ (policy)?.approvedSteps?.[step.id];
  if (!a || typeof a !== 'object') return 'STEP_NOT_APPROVED_IN_POLICY';
  if (!ISO_DAY.test(String(a.approvedOn || ''))) return 'STEP_APPROVAL_DATE_MISSING';
  if (!ISO_DAY.test(String(a.dryRunReviewedOn || ''))) return 'STEP_DRY_RUN_REVIEW_MISSING';
  if (String(a.dryRunReviewedOn) > String(a.approvedOn)) return 'STEP_DRY_RUN_REVIEW_AFTER_APPROVAL';
  if (typeof a.backupVerified !== 'string' || a.backupVerified.trim().length < 3) return 'STEP_BACKUP_VERIFICATION_MISSING';
  if (step.sharedController && (typeof a.sharedControllerBasis !== 'string' || a.sharedControllerBasis.trim().length < 3)) return 'STEP_SHARED_CONTROLLER_BASIS_MISSING';
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

/** A public summary of a policy (no secret, no personal data). @param {RetentionPolicy} policy */
export function policySummary(policy) {
  return { id: policy.id, version: policy.version, status: policy.status, approved: isPolicyApproved(policy), approvedPolicyVersion: policy.approvedPolicyVersion ?? null, source: policy.source,
    ownerChoicesOpen: missingOwnerChoices(policy), approvedChoices: /** @type {any} */ (policy).approvedChoices ?? null,
    approvedStepCount: Object.keys(/** @type {any} */ (policy).approvedSteps || {}).length };
}
