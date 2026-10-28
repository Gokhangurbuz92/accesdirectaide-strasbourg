/**
 * PKG-5 (2026-10-21) — the privacy registry must describe what the purge job really does. It used to say AuditLog / ConsentLog were never deleted automatically while
 * cron/gdpr-purge deleted them after 365 / 1095 days. Contract: a registry entry with action DELETE and an implementing job has the job's duration; an entry no job applies
 * says so (implementedBy null); open questions stay flagged for the DPO.
 */
import { describe, expect, it } from 'vitest';
import { RETENTION_POLICY_REGISTRY as R } from '../../api/_services/privacy.js';
import { RETENTION } from '../../api/_handlers/cron/gdpr-purge.js';

describe('retention registry vs purge job', () => {
  it('AuditLog and ConsentLog: same duration as the purge, still flagged for review', () => {
    expect([R.AUDIT_LOG.durationDays, R.AUDIT_LOG.action, R.AUDIT_LOG.implementedBy]).toEqual([RETENTION.AUDIT_LOG_DAYS, 'DELETE', 'cron/gdpr-purge']);
    expect([R.CONSENT_LOG.durationDays, R.CONSENT_LOG.action, R.CONSENT_LOG.implementedBy]).toEqual([RETENTION.CONSENT_LOG_DAYS, 'DELETE', 'cron/gdpr-purge']);
    expect(R.AUDIT_LOG.requiresReview && R.CONSENT_LOG.requiresReview).toBe(true);
  });
  it('the 2-year inactive-account rule is declared as NOT implemented by any job', () => {
    expect(R.INACTIVE_ACCOUNT.implementedBy).toBeNull();
  });
});
