/**
 * R44 — test-only approval of the retention policy. Production code never approves the policy (api/_services/retention-policy.js stays PROPOSED — NOT
 * APPROVED); tests that check what an EXECUTING purge does build the handler with a COPY of the policy marked approved, and set the three execution
 * variables (enabled, pinned version, approved steps).
 * R45 / ENG-LR-9: an approved copy also needs (1) the owner choice A7 made and named in its version — tests use 730 days by default (the value the R44
 * fixtures were written for: a TEST value, not a decision) — and (2) each step's own approval record (dry run read, backup verified, written agreement,
 * and the structure basis for shared-controller steps): the test copy approves every step it is asked for.
 */
import { RETENTION_POLICY, POLICY_STATUS_APPROVED, choiceTag } from '../../api/_services/retention-policy.js';

/** the per-step approval record a test copy carries for every step (synthetic) */
export const TEST_STEP_APPROVAL = Object.freeze({ approvedOn: '2026-11-05', dryRunReviewedOn: '2026-11-05', backupVerified: 'test-backup-verified', sharedControllerBasis: 'test-structure-agreement' });

/** the version of the approved test copy for an A7 option @param {number} [a7] */
export const testPolicyVersion = (a7 = 730) => `${RETENTION_POLICY.version}-test-${choiceTag('A7', a7)}`;
export const TEST_POLICY_VERSION = testPolicyVersion(730);

/**
 * a copy of the proposed policy, marked approved (tests only)
 * @param {{ a7?: number, steps?: string[] | null }} [opts] steps: the step ids approved in the policy record (default: every step)
 */
export const approvedTestPolicy = ({ a7 = 730, steps = null } = {}) => {
  const version = testPolicyVersion(a7);
  const approvedSteps = steps
    ? Object.fromEntries(steps.map((id) => [id, TEST_STEP_APPROVAL]))
    : new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? TEST_STEP_APPROVAL : undefined) });
  return { ...RETENTION_POLICY, version, status: POLICY_STATUS_APPROVED, approvedPolicyVersion: version, approvedChoices: { A7: a7 }, approvedSteps };
};

/** @param {string[]} steps the approved step ids @param {{ a7?: number }} [opts] */
export const approvalEnv = (steps, { a7 = 730 } = {}) => ({ GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: testPolicyVersion(a7), GDPR_PURGE_APPROVED_STEPS: steps.join(',') });

const KEYS = ['GDPR_PURGE_ENABLED', 'GDPR_PURGE_POLICY_VERSION', 'GDPR_PURGE_APPROVED_STEPS'];
/** sets the approval variables on process.env; returns the function that removes them @param {string[]} steps */
export function setApprovalEnv(steps) {
  Object.assign(process.env, approvalEnv(steps));
  return () => { for (const k of KEYS) delete process.env[k]; };
}

/** every executable step id of the purge @param {{ id: string, kind: string }[]} steps */
export const executableStepIds = (steps) => steps.filter((s) => s.kind !== 'report').map((s) => s.id);
