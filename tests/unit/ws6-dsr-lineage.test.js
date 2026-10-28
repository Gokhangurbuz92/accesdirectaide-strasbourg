import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    USER_PERSONAL_DATA_LINEAGE,
    createPrivacyRightsService,
} from '../../api/_services/privacy.js';

function mockCrypto() {
    return {
        createHash() {
            let value = '';
            return {
                update(input) {
                    value += String(input);
                    return this;
                },
                digest() {
                    return `sha256:${value}`;
                },
            };
        },
        randomBytes() {
            return { toString: () => 'guest-secret' };
        },
    };
}

describe('WS6 USER_PERSONAL_DATA_LINEAGE', () => {
    it('preserves frozen policy classifications and catalog immunity', () => {
        expect(USER_PERSONAL_DATA_LINEAGE.CitizenProfile.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.CitizenSession.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.DocumentUpload.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.TelemetryRecord.action).toBe('ANONYMIZE');
        expect(USER_PERSONAL_DATA_LINEAGE.EligibilitySimulation.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.CitizenAppointment.action).toBe('ANONYMIZE');
        expect(USER_PERSONAL_DATA_LINEAGE.CitizenMessaging.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.OperationalConsent.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.GuardianRelationship.action).toBe('DELETE');
        expect(USER_PERSONAL_DATA_LINEAGE.ConsentLog.action).toBe('RETAIN_WITH_LEGAL_BASIS');
        expect(USER_PERSONAL_DATA_LINEAGE.DSRRequest.action).toBe('RETAIN_WITH_LEGAL_BASIS');
        expect(USER_PERSONAL_DATA_LINEAGE.LegalHold.action).toBe('RETAIN_WITH_LEGAL_BASIS');

        for (const entity of ['Aide', 'Structure', 'Demarche', 'Territory']) {
            expect(USER_PERSONAL_DATA_LINEAGE[entity].action).toBe('NOT_USER_SCOPED');
        }
    });

    it('exports user-scoped records while removing authentication and rights secrets', async () => {
        const db = {
            query: {
                CitizenUser: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: 'u1',
                        email: 'citizen@example.test',
                        passwordHash: 'never-export',
                    }),
                },
                ConversationLog: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', sessionId: 'u1' }]) },
                ProAppointment: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', citizenUserId: 'u1' }]) },
                AuthToken: {
                    findMany: vi.fn().mockResolvedValue([{
                        id: 't1',
                        userId: 'u1',
                        tokenHash: 'never-export',
                        type: 'EMAIL_VERIFY',
                    }]),
                },
                SharedDiagnostic: {
                    findMany: vi.fn().mockResolvedValue([{
                        id: 'd1',
                        privacySubjectId: 'u1',
                        rightsSecretHash: 'never-export',
                        situation: { need: 'housing' },
                    }]),
                },
                ConsentLog: { findMany: vi.fn().mockResolvedValue([{ id: 'co1', subject_id: 'u1' }]) },
                DSRRequest: { findMany: vi.fn().mockResolvedValue([{ id: 'r1', subjectId: 'u1' }]) },
                RdvConversation: { findMany: vi.fn().mockResolvedValue([{ id: 'rc1', citizenUserId: 'u1' }]) },
                RdvConversationMessage: { findMany: vi.fn().mockResolvedValue([{ id: 'rm1', conversationId: 'rc1' }]) },
                RdvNotificationLog: { findMany: vi.fn().mockResolvedValue([{ id: 'rn1', conversationId: 'rc1' }]) },
                UserConsent: { findMany: vi.fn().mockResolvedValue([{ id: 'uc1', citizenId: 'u1' }]) },
                GuardianRelationship: { findMany: vi.fn().mockResolvedValue([{ id: 'g1', minorId: 'u1', guardianId: 'g2' }]) },
                LegalHold: { findMany: vi.fn().mockResolvedValue([]) },
                AuditLog: { findMany: vi.fn().mockResolvedValue([]) },
            },
        };

        const service = createPrivacyRightsService({ db, cryptoLib: mockCrypto() });
        const exported = await service.getExportData('u1');
        const serialized = JSON.stringify(exported);

        expect(exported.profile.passwordHash).toBeUndefined();
        expect(exported.authTokens[0].tokenHash).toBeUndefined();
        expect(exported.diagnostics[0].rightsSecretHash).toBeUndefined();
        expect(serialized).not.toContain('never-export');
        expect(exported.conversations).toHaveLength(1);
        expect(exported.appointments).toHaveLength(1);
        expect(exported.consents).toHaveLength(1);
        expect(exported.dsrRequests).toHaveLength(1);
        expect(exported.rdvConversations).toHaveLength(1);
        expect(exported.rdvMessages).toHaveLength(1);
        expect(exported.rdvNotifications).toHaveLength(1);
        expect(exported.operationalConsents).toHaveLength(1);
        expect(exported.guardianRelationships).toHaveLength(1);
    });

    it('fails closed when an export subject cannot be resolved', async () => {
        const db = {
            query: {
                CitizenUser: { findFirst: vi.fn().mockResolvedValue(null) },
            },
        };
        const service = createPrivacyRightsService({ db, cryptoLib: mockCrypto() });
        await expect(service.executeExportRequest('missing')).rejects.toMatchObject({
            code: 'SUBJECT_NOT_FOUND',
        });
    });

    it('does not grant product code a deletion path to reference catalogs', () => {
        const privacySource = readFileSync('api/_services/privacy.js', 'utf8');
        const deletionHandler = readFileSync('api/_handlers/auth/delete-account.js', 'utf8');

        for (const entity of ['Aide', 'Structure', 'Demarche', 'Territory']) {
            expect(privacySource).not.toMatch(new RegExp(`db\\.delete\\(${entity}\\)`));
            expect(deletionHandler).not.toMatch(new RegExp(`db\\.delete\\(${entity}\\)`));
        }
    });

    it('keeps delete-account on human review and routes it through the DSR engine', () => {
        const source = readFileSync('api/_handlers/auth/delete-account.js', 'utf8');
        expect(source).toContain('requestDeletion(userId)');
        expect(source).toContain('res.status(202)');
        expect(source).not.toContain('db.delete(');
        expect(source).not.toContain('buildUserSessionCookieClear');
    });

    it('routes exports through the automatic-safe DSR execution method', () => {
        const source = readFileSync('api/_handlers/auth/export-data.js', 'utf8');
        expect(source).toContain('executeExportRequest(userId)');
        expect(source).toContain('X-DSR-Request-Id');
        expect(source).not.toContain('passwordHash');
        expect(source).not.toContain('tokenHash');
    });

    it('contains no remote network primitive in the WS6 product mutation scope', () => {
        for (const path of [
            'api/_services/privacy.js',
            'api/_handlers/auth/export-data.js',
            'api/_handlers/auth/delete-account.js',
        ]) {
            const source = readFileSync(path, 'utf8');
            expect(source).not.toMatch(/\bfetch\s*\(/);
            expect(source).not.toContain('http://');
            expect(source).not.toContain('https://');
        }
    });
});

describe('WS6 V2 lineage completeness repair', () => {
    it('classifies every mechanically discovered citizen-linked domain', () => {
        const expected = {
            CitizenAppointment: 'ANONYMIZE',
            CitizenMessaging: 'DELETE',
            OperationalConsent: 'DELETE',
            GuardianRelationship: 'DELETE',
            AuditLog: 'RETAIN_WITH_LEGAL_BASIS',
        };

        for (const [domain, action] of Object.entries(expected)) {
            expect(USER_PERSONAL_DATA_LINEAGE[domain]?.action).toBe(action);
        }
    });

    it('contains exact targeted erasure operations for newly classified deletable domains', () => {
        const source = readFileSync('api/_services/privacy.js', 'utf8');
        expect(source).toContain('tx.delete(RdvConversation)');
        expect(source).toContain('tx.delete(UserConsent)');
        expect(source).toContain('tx.delete(GuardianRelationship)');
        expect(source).toContain('RdvNotificationLog.conversationId');
        expect(source).toContain('RdvConversationMessage.conversationId');
    });

    it('retains canonical consent, DSR, LegalHold and audit evidence', () => {
        for (const domain of ['ConsentLog', 'DSRRequest', 'LegalHold', 'AuditLog']) {
            expect(USER_PERSONAL_DATA_LINEAGE[domain].action).toBe('RETAIN_WITH_LEGAL_BASIS');
        }
    });
});
