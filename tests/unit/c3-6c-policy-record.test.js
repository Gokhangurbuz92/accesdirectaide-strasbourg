// C3 step 6c (V2 stage 6B): the policy approves ONLY unverifiedAccountsDeleted; nothing executes without the 6B environment.
import { describe, expect, it } from 'vitest';
import { RETENTION_POLICY, executionGate, stepApprovalProblem } from '../../api/_services/retention-policy.js';

describe('C3 6c policy record', () => {
  it('approves unverifiedAccountsDeleted completely (dates, dry-run review not after approval, backup evidence)', () => {
    expect(stepApprovalProblem(RETENTION_POLICY, { id: 'unverifiedAccountsDeleted' })).toBeNull();
  });
  it('approves no other step', () => {
    for (const id of ['deletedTokensCount', 'rdvConversationsDeleted', 'auditLogsDeleted', 'citizenErasure', 'x']) {
      expect(stepApprovalProblem(RETENTION_POLICY, { id })).toBe('STEP_NOT_APPROVED_IN_POLICY');
    }
  });
  it('stays a dry run without the 6B environment (fail-closed at every gate)', () => {
    expect(executionGate(RETENTION_POLICY, {}).execute).toBe(false);
    expect(executionGate(RETENTION_POLICY, {}).reason).toBe('GDPR_PURGE_DISABLED');
    expect(executionGate(RETENTION_POLICY, { GDPR_PURGE_ENABLED: 'true' }).reason).toBe('POLICY_VERSION_NOT_PINNED');
    expect(executionGate(RETENTION_POLICY, { GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version }).reason).toBe('NO_APPROVED_STEPS');
    expect(executionGate(RETENTION_POLICY, { GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version,
      GDPR_PURGE_APPROVED_STEPS: 'unverifiedAccountsDeleted' }, { dryRunRequested: true }).reason).toBe('DRY_RUN_REQUESTED');
  });
  it('the record is frozen', () => {
    expect(Object.isFrozen(RETENTION_POLICY.approvedSteps.unverifiedAccountsDeleted)).toBe(true);
  });
});
