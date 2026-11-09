/**
 * R44 — test-only approval of the retention policy. Since V2 phase 1 (owner, 09/11/2026) the production policy is APPROVED (A7 = 365) but approves NO
 * purge step; `proposedTestPolicy()` keeps the unapproved proposal for the tests of the « not approved » path. Tests that check what an EXECUTING purge does build the handler with a COPY of the policy marked approved, and set the three execution
 * variables (enabled, pinned version, approved steps).
 * R45 / ENG-LR-9: an approved copy also needs (1) the owner choice A7 made and named in its version — tests use 730 days by default (the value the R44
 * fixtures were written for: a TEST value, not a decision) — and (2) each step's own approval record (dry run read, backup verified, written agreement,
 * and the structure basis for shared-controller steps): the test copy approves every step it is asked for.
 */
import { RETENTION_POLICY, POLICY_STATUS_APPROVED, POLICY_STATUS_PROPOSED, choiceTag } from '../../api/_services/retention-policy.js';

/** the proposal the owner reviewed (durations of RETENTION_POLICY, no choice, no approval) */
export const PROPOSAL_VERSION = 'r45-proposal-2-2026-11-05';
/** a copy of the policy as it was BEFORE the controller's approval (tests of the not-approved path) */
export const proposedTestPolicy = () => {
  const copy = /** @type {any} */ ({ ...RETENTION_POLICY });
  for (const k of ['approvedPolicyVersion', 'approvedChoices', 'approvedSteps']) delete copy[k];
  return { ...copy, version: PROPOSAL_VERSION, status: POLICY_STATUS_PROPOSED };
};

/** the per-step approval record a test copy carries for every step (synthetic) */
export const TEST_STEP_APPROVAL = Object.freeze({ approvedOn: '2026-11-05', dryRunReviewedOn: '2026-11-05', backupVerified: 'test-backup-verified', sharedControllerBasis: 'test-structure-agreement' });

/** the version of the approved test copy for an A7 option @param {number} [a7] */
export const testPolicyVersion = (a7 = 730) => `${PROPOSAL_VERSION}-test-${choiceTag('A7', a7)}`;
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
