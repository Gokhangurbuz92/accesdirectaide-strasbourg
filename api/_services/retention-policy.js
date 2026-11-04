/**
 * R44 / E16 — the VERSIONED retention policy that drives cron/gdpr-purge (and the backup rotation of scripts/db-backup.mjs).
 *
 * Every duration below is the PROPOSAL of the R43 dossier (STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r43/R43_DOSSIER_RGPD_ACTIVATION_FR.md § 3.1, each one
 * « [PROPOSITION — À VALIDER RT] »). None is a decision: the policy status is PROPOSED — NOT APPROVED and `approvedPolicyVersion` is deliberately ABSENT.
 * Engineering never approves it. The controller's decision is recorded by a reviewed commit that (1) adjusts the durations if needed, (2) sets
 * `status: 'APPROVED'` and (3) sets `approvedPolicyVersion` to the exact `version` approved. Until then no purge step can delete or anonymise anything.
 *
 * Real execution of ONE step needs ALL of (api/_handlers/cron/gdpr-purge.js `executionGate`):
 *   - GDPR_PURGE_ENABLED=true (the operator switch, unchanged since R33);
 *   - this policy approved: status APPROVED and approvedPolicyVersion === version;
 *   - GDPR_PURGE_POLICY_VERSION === version (the deployment pins the version it was approved for: a later code change of a duration cannot silently run);
 *   - the step id listed in GDPR_PURGE_APPROVED_STEPS (comma separated: approval can be partial, step by step — E16);
 *   - the step is executable (report-only steps never are).
 * Otherwise the run is a DRY RUN: it counts what each step would touch and changes nothing.
 *
 * No value here is a legal obligation: « Obligation légale » is stated only with a read and cited text (R43 § 3); none was identified for these durations.
 */

export const POLICY_STATUS_PROPOSED = 'PROPOSED — NOT APPROVED';
export const POLICY_STATUS_APPROVED = 'APPROVED';

/**
 * @typedef {{ days: number, anchor: string, basis: string, ecode?: string }} PolicyDuration
 * @typedef {{ id: string, version: string, status: string, approvedPolicyVersion?: string, source: string, durations: Record<string, PolicyDuration> }} RetentionPolicy
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
  version: 'r44-proposal-1-2026-11-04',
  status: POLICY_STATUS_PROPOSED,
  // approvedPolicyVersion: ABSENT on purpose (set only by the controller's decision, see above)
  source: 'R43_DOSSIER_RGPD_ACTIVATION_FR.md § 3.1 — [PROPOSITION — À VALIDER RT]',
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
    APPOINTMENT_CONFIRMED_DAYS: { days: 730, anchor: 'startAt (date of the appointment)', basis: OPS, ecode: 'E1' },
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
    INACTIVE_ACCOUNT_DAYS: { days: 730, anchor: 'CitizenUser.lastSeenAt', basis: OPS, ecode: 'E7' },
    INACTIVE_WARNING_GRACE_DAYS: { days: 30, anchor: 'warning e-mail sent (not built)', basis: OPS, ecode: 'E7' },
    PRO_USER_DISABLED_DAYS: { days: 365, anchor: 'disabling date (not recorded on 0042)', basis: OPS, ecode: 'E9b' },
    BACKUP_KEEP_DAYS: { days: 30, anchor: 'backup file time', basis: OPS, ecode: 'E15' },
    BACKUP_KEEP_WEEKLY: { days: 4, anchor: 'number of weekly backups kept beyond BACKUP_KEEP_DAYS (a count, not days)', basis: OPS, ecode: 'E15' },
  },
});

/** The number of days of a policy duration (throws on an unknown key: a step can never run with an undefined duration). @param {RetentionPolicy} policy @param {string} key */
export function policyDays(policy, key) {
  const d = policy?.durations?.[key];
  if (!d || !Number.isInteger(d.days) || d.days <= 0) throw new Error(`retention policy ${policy?.version}: no duration ${key}`);
  return d.days;
}

/** The policy records the controller's approval of THIS version. @param {RetentionPolicy} policy */
export function isPolicyApproved(policy) {
  return Boolean(policy) && policy.status === POLICY_STATUS_APPROVED && typeof policy.approvedPolicyVersion === 'string'
    && policy.approvedPolicyVersion.length > 0 && policy.approvedPolicyVersion === policy.version;
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
  if (!isPolicyApproved(policy)) return no('POLICY_NOT_APPROVED');
  if (String(env.GDPR_PURGE_POLICY_VERSION || '').trim() !== policy.version) return no('POLICY_VERSION_NOT_PINNED');
  if (approvedSteps.size === 0) return no('NO_APPROVED_STEPS');
  return { execute: true, reason: null, approvedSteps };
}

/** A public summary of a policy (no secret, no personal data). @param {RetentionPolicy} policy */
export function policySummary(policy) {
  return { id: policy.id, version: policy.version, status: policy.status, approved: isPolicyApproved(policy), approvedPolicyVersion: policy.approvedPolicyVersion ?? null, source: policy.source };
}
