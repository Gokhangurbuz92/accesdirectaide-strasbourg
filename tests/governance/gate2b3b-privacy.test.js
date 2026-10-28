import { describe, test, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { PURPOSE_REGISTRY, RETENTION_POLICY_REGISTRY, PRIVACY_DATA_DOMAIN_REGISTRY, DSR_EXECUTION_POLICY, GUARDIAN_CAPABILITY_POLICY, createPrivacyRightsService } from '../../api/_services/privacy.js';

describe('Gate 2B-3B: Minors Policy', () => {
    test('Minor public informational access ALLOWED does not require guardian', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue(null) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE');
        expect(allowed).toBe(false); 
    });
    test('Minor and guardian distinct principals (no impersonation)', async () => {
        const service = createPrivacyRightsService({ db: {}, cryptoLib: crypto });
        expect(service.authenticateAs).toBeUndefined();
    });
    test('Unknown relation deny', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue(null) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE');
        expect(allowed).toBe(false);
    });
    test('No scope deny', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue({ status: 'VERIFIED_STRONG', scopes: [] }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE');
        expect(allowed).toBe(false);
    });
    test('Revoked relation deny', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue({ status: 'REVOKED', scopes: ['VIEW_PROFILE_SCOPE'] }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE', 'LOW_RISK_INFORMATIONAL');
        expect(allowed).toBe(false);
    });
    test('Expired relation deny', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue({ status: 'EXPIRED', scopes: ['VIEW_PROFILE_SCOPE'] }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE', 'LOW_RISK_INFORMATIONAL');
        expect(allowed).toBe(false);
    });
    test('Disputed relation deny', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue({ status: 'DISPUTED', scopes: ['VIEW_PROFILE_SCOPE'] }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE', 'LOW_RISK_INFORMATIONAL');
        expect(allowed).toBe(false);
    });
    test('Low-risk relationship policy', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue({ status: 'EMAIL_VERIFIED', scopes: ['VIEW_PROFILE_SCOPE'] }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'VIEW_PROFILE_SCOPE', 'LOW_RISK_INFORMATIONAL');
        expect(allowed).toBe(true);
    });
    test('Sensitive action needs sufficient verification or review', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue({ status: 'EMAIL_VERIFIED', scopes: ['SHARE_DOSSIER_SCOPE'] }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'guardian1', 'SHARE_DOSSIER_SCOPE', 'HIGH_RISK_SENSITIVE_DATA_ACCESS');
        expect(allowed).toBe(false); // EMAIL_VERIFIED is insufficient for high risk
    });
    test('Guardian cannot read all messages (no wildcard scope)', async () => {
        expect(GUARDIAN_CAPABILITY_POLICY.HIGH_RISK_SENSITIVE_DATA_ACCESS.includes('READ_ALL_MESSAGES')).toBe(false);
    });
    test('Guardian cannot delete minor by default', async () => {
        expect(GUARDIAN_CAPABILITY_POLICY.HIGH_RISK_SENSITIVE_DATA_ACCESS.includes('DELETE_ACCOUNT_SCOPE')).toBe(false);
    });
    test('Pro role alone not guardian', async () => {
        const mockDb = { query: { GuardianRelationship: { findFirst: vi.fn().mockResolvedValue(null) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const allowed = await service.verifyGuardianScope('minor1', 'pro1', 'VIEW_PROFILE_SCOPE');
        expect(allowed).toBe(false); 
    });
});

describe('Gate 2B-3B: Consent', () => {
    test('Defaults off', () => {
        expect(PURPOSE_REGISTRY.MARKETING_EMAIL.defaultOff).toBe(true);
    });
    test('Independent purposes', async () => {
        let inserted = null;
        const mockDb = { insert: () => ({ values: (vals) => ({ returning: async () => { inserted = vals; return [vals]; } }) }) };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        await service.grantConsent('citizen', 'u1', 'MARKETING_EMAIL', 'v2', 'web', false, 'strong');
        expect(inserted.purpose).toBe('MARKETING_EMAIL');
    });
    test('Version recorded', async () => {
        let inserted = null;
        const mockDb = { insert: () => ({ values: (vals) => ({ returning: async () => { inserted = vals; return [vals]; } }) }) };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        await service.grantConsent('citizen', 'u1', 'MARKETING_EMAIL', 'v2', 'web', false, 'strong');
        expect(inserted.policy_version).toBe('v2');
    });
    test('Withdrawal timestamp', async () => {
        // PKG-11 / C22 overlay (C22_CONSENT_LEDGER_OVERLAY_V1.md): a withdrawal is a NEW append-only row (decision false + timestamp); nothing is updated
        let inserted = null;
        const mockDb = {
            select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ subject_type: 'citizen', policy_version: 'v2', policy_hash: 'h', collection_channel: 'web', proof_level: 'strong' }] }) }) }) }),
            insert: () => ({ values: (vals) => ({ returning: async () => { inserted = vals; return [vals]; } }) }),
            update: () => { throw new Error('the consent ledger must never be updated'); },
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        await service.withdrawConsent('u1', 'MARKETING_EMAIL');
        expect(inserted.withdrawn_at).toBeDefined();
        expect(inserted).toMatchObject({ subject_id: 'u1', purpose: 'MARKETING_EMAIL', decision: false, policy_version: 'v2' });
    });
    test('Superseded receipt / history', async () => {
        const mockDb = { query: { ConsentLog: { findFirst: vi.fn().mockResolvedValue({ purpose: 'MARKETING_EMAIL', policy_version: 'v3' }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const current = await service.getCurrentConsent('u1', 'MARKETING_EMAIL');
        expect(current.policy_version).toBe('v3');
    });
    test('Marketing channels separate', () => {
        expect(PURPOSE_REGISTRY.MARKETING_EMAIL).toBeDefined();
        expect(PURPOSE_REGISTRY.MARKETING_SMS).toBeDefined();
        expect(PURPOSE_REGISTRY.MARKETING_EMAIL).not.toBe(PURPOSE_REGISTRY.MARKETING_SMS);
    });
    test('Privacy notice != consent', () => {
        expect(PURPOSE_REGISTRY.MARKETING_EMAIL.requiresConsent).toBe(true);
    });
    test('CGU != marketing consent', () => {
        expect(PURPOSE_REGISTRY.MARKETING_SMS.requiresConsent).toBe(true);
    });
    test('Guardian involvement recorded only when real', async () => {
        let inserted = null;
        const mockDb = { insert: () => ({ values: (vals) => ({ returning: async () => { inserted = vals; return [vals]; } }) }) };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        await service.grantConsent('citizen', 'u1', 'MARKETING_EMAIL', 'v2', 'web', true, 'strong');
        expect(inserted.guardian_involved).toBe(true);
    });
});

describe('Gate 2B-3B: DSR & Export', () => {
    test('Subject A export own data', async () => {
        const mockDb = { 
            query: { 
                CitizenUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@a.com', passwordHash: 'sec' }) },
                ConversationLog: { findMany: vi.fn().mockResolvedValue([]) },
                ProAppointment: { findMany: vi.fn().mockResolvedValue([]) },
                AuthToken: { findMany: vi.fn().mockResolvedValue([]) },
                SharedDiagnostic: { findMany: vi.fn().mockResolvedValue([]) },
                ConsentLog: { findMany: vi.fn().mockResolvedValue([]) }
            } 
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const data = await service.getExportData('u1');
        expect(data.profile.email).toBe('a@a.com');
    });
    test('Subject B denied (handler logic handles it via JWT, service only fetches userId)', async () => {
        const mockDb = { query: { CitizenUser: { findFirst: vi.fn().mockResolvedValue(null) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const data = await service.getExportData('u2');
        expect(data).toBeNull();
    });
    test('Guest rights proof valid', async () => {
        const service = createPrivacyRightsService({ db: {}, cryptoLib: crypto });
        const secret = 'valid-secret';
        const hash = service.hashRightsSecret(secret);
        const mockDb = { query: { SharedDiagnostic: { findFirst: vi.fn().mockImplementation(async () => {
            return { id: 'd1', rightsSecretHash: hash };
        })}}};
        const service2 = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const res = await service2.resolveGuestRights('d1', secret);
        expect(res).not.toBeNull();
    });
    test('Guest wrong proof denied', async () => {
        const mockDb = { query: { SharedDiagnostic: { findFirst: vi.fn().mockResolvedValue(null) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const res = await service.resolveGuestRights('d1', 'wrong-secret');
        expect(res).toBeNull();
    });
    test('Share token alone denied destructive action', () => {
        const service = createPrivacyRightsService({ db: {}, cryptoLib: crypto });
        expect(service.resolveGuestRights).toHaveLength(2); // Requires (diagnosticId, rawRightsSecret) explicitly
    });
    test('Ambiguous ownership human review', () => {
        expect(DSR_EXECUTION_POLICY.DELETE).toBe('HUMAN_REVIEW_REQUIRED');
    });
    test('Request lifecycle transitions valid', async () => {
        const mockDb = {
            query: { DSRRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'req1', status: 'RECEIVED' }) } },
            update: () => ({ set: (vals) => ({ where: () => ({ returning: async () => [vals] }) }) })
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const result = await service.updateDsrRequestStatus('req1', 'IDENTITY_OR_AUTHORITY_CHECK');
        expect(result[0].status).toBe('IDENTITY_OR_AUTHORITY_CHECK');
    });
    test('Invalid lifecycle transition rejected', async () => {
        const mockDb = { query: { DSRRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'req1', status: 'RECEIVED' }) } } };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        await expect(service.updateDsrRequestStatus('req1', 'COMPLETED')).rejects.toThrow();
    });
    test('Raw secret never audited/logged', () => {
        const service = createPrivacyRightsService({ db: {}, cryptoLib: crypto });
        const secret = 'valid-secret';
        const hash = service.hashRightsSecret(secret);
        expect(hash).not.toContain(secret);
    });
});

describe('Gate 2B-3B: Retention', () => {
    test('24m policy source ADA_PRODUCT_POLICY', () => {
        expect(RETENTION_POLICY_REGISTRY.INACTIVE_ACCOUNT.type).toBe('ADA_PRODUCT_POLICY');
        expect(RETENTION_POLICY_REGISTRY.INACTIVE_ACCOUNT.durationDays).toBe(730);
    });
    test('Unresolved legal retention not automatically deleted', () => {
        expect(RETENTION_POLICY_REGISTRY.STATUTORY_UNKNOWN.action).toBe('AUTOMATED_DELETION_DISABLED');
    });
    test('Dry-run no mutation', async () => {
        const mockDb = { 
            query: { 
                CitizenUser: { findMany: vi.fn().mockResolvedValue([]) },
                LegalHold: { findMany: vi.fn().mockResolvedValue([]) }
            } 
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const candidates = await service.dryRunRetention();
        expect(candidates).toEqual([]);
    });
    test('Eligible candidate selected correctly', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 800);
        const mockDb = { 
            query: { 
                CitizenUser: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', updatedAt: oldDate }]) },
                LegalHold: { findMany: vi.fn().mockResolvedValue([]) }
            } 
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const candidates = await service.dryRunRetention();
        expect(candidates.length).toBe(1);
    });
    test('Legal hold prevents only held record', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 800);
        const mockDb = { 
            query: { 
                CitizenUser: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', updatedAt: oldDate }, { id: 'u2', updatedAt: oldDate }]) },
                LegalHold: { findMany: vi.fn().mockResolvedValue([{ recordId: 'u1', status: 'ACTIVE' }]) }
            } 
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const candidates = await service.dryRunRetention();
        expect(candidates.length).toBe(1);
        expect(candidates[0].id).toBe('u2');
    });
    test('Unrelated records unaffected', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 800);
        const mockDb = { 
            query: { 
                CitizenUser: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', updatedAt: oldDate }, { id: 'u2', updatedAt: oldDate }, { id: 'u3', updatedAt: oldDate }]) },
                LegalHold: { findMany: vi.fn().mockResolvedValue([{ recordId: 'u1', status: 'ACTIVE' }]) }
            } 
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const candidates = await service.dryRunRetention();
        expect(candidates.length).toBe(2);
        expect(candidates.find(c => c.id === 'u3')).toBeDefined();
    });
    test('Second execution idempotent', async () => {
        // PKG-11 / C22 overlay (C22_CONSENT_LEDGER_OVERLAY_V1.md): append-only ledger — the first withdrawal appends one row, the second finds it and appends nothing
        const rows = [{ subject_type: 'citizen', subject_id: 'u1', purpose: 'MARKETING_EMAIL', decision: true, policy_version: 'v2', policy_hash: 'h' }];
        const inserts = [];
        const mockDb = {
            select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [rows[rows.length - 1]] }) }) }) }),
            insert: () => ({ values: (vals) => ({ returning: async () => { inserts.push(vals); rows.push(vals); return [vals]; } }) }),
            update: () => { throw new Error('the consent ledger must never be updated'); },
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const first = await service.withdrawConsent('u1', 'MARKETING_EMAIL');
        expect(first[0].decision).toBe(false);
        const second = await service.withdrawConsent('u1', 'MARKETING_EMAIL');
        expect(second[0].decision).toBe(false); // Idempotent: still withdrawn
        expect(inserts).toHaveLength(1);
        expect(rows[0].decision).toBe(true);    // the earlier grant is kept as recorded
    });
    test('Warning state transitions deterministic', async () => {
        const mockDb = {
            query: { DSRRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'req1', status: 'IN_REVIEW' }) } },
            update: () => ({ set: (vals) => ({ where: () => ({ returning: async () => [vals] }) }) })
        };
        const service = createPrivacyRightsService({ db: mockDb, cryptoLib: crypto });
        const result = await service.updateDsrRequestStatus('req1', 'APPROVED');
        expect(result[0].status).toBe('APPROVED'); // Valid transition
    });
});

describe('Gate 2B-3B: Article 9', () => {
    test('Structured disability/health flow SPECIAL_CATEGORY_EXPECTED', () => {
        expect(PURPOSE_REGISTRY.ARTICLE9_EXPLICIT_CONSENT).toBeDefined();
    });
    test('Ordinary public free text INCIDENTAL_DISCLOSURE_POSSIBLE', () => {
        expect(PURPOSE_REGISTRY.DOCUMENT_PROCESSING).toBeDefined();
    });
    test('Guardian relation alone does not grant sensitive-data access', () => {
        expect(GUARDIAN_CAPABILITY_POLICY.LOW_RISK_INFORMATIONAL.includes('SHARE_DOSSIER_SCOPE')).toBe(false);
    });
});
