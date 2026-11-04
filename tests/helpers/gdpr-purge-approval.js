/**
 * R44 — test-only approval of the retention policy. Production code never approves the policy (api/_services/retention-policy.js stays PROPOSED — NOT
 * APPROVED); tests that check what an EXECUTING purge does build the handler with a COPY of the policy marked approved, and set the three execution
 * variables (enabled, pinned version, approved steps).
 */
import { RETENTION_POLICY, POLICY_STATUS_APPROVED } from '../../api/_services/retention-policy.js';

/** a copy of the proposed policy, marked approved (tests only) */
export const approvedTestPolicy = () => ({ ...RETENTION_POLICY, status: POLICY_STATUS_APPROVED, approvedPolicyVersion: RETENTION_POLICY.version });

/** @param {string[]} steps the approved step ids */
export const approvalEnv = (steps) => ({ GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version, GDPR_PURGE_APPROVED_STEPS: steps.join(',') });

const KEYS = ['GDPR_PURGE_ENABLED', 'GDPR_PURGE_POLICY_VERSION', 'GDPR_PURGE_APPROVED_STEPS'];
/** sets the approval variables on process.env; returns the function that removes them @param {string[]} steps */
export function setApprovalEnv(steps) {
  Object.assign(process.env, approvalEnv(steps));
  return () => { for (const k of KEYS) delete process.env[k]; };
}

/** every executable step id of the purge @param {{ id: string, kind: string }[]} steps */
export const executableStepIds = (steps) => steps.filter((s) => s.kind !== 'report').map((s) => s.id);
