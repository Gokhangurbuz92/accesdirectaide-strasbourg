import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
// Launch readiness item 60: SharedDiagnostic.situation is encrypted at rest by its column type; a Drizzle client built outside src/db/index.ts
// loads the same codec (it needs ADA_ENCRYPTION_KEY, which the test profile sets).
import '../../api/lib/situation-codec.js';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';

const { Pool } = pg;

const EXPECTED_PREFIX = 'ada_ws6_e2e_';
const FORBIDDEN_DB = 'acces_direct_aide_test';

let pool;
let db;
let privacyService;

const catalog = {
    aideId: 'ws6-catalog-aide',
    structureId: 'ws6-catalog-structure',
    demarcheId: 'ws6-catalog-demarche',
    territoryId: 'ws6-catalog-territory',
    serviceId: 'ws6-catalog-rdv-service',
};

function requireDisposableDatabaseUrl() {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error('DATABASE_URL is required for WS6 disposable E2E proof');

    const url = new URL(raw);
    const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const expectedName = process.env.WS6_DISPOSABLE_DB_NAME;

    if (url.hostname !== '127.0.0.1') {
        throw new Error(`WS6 E2E requires loopback PostgreSQL, got host=${url.hostname}`);
    }
    if (!dbName.startsWith(EXPECTED_PREFIX)) {
        throw new Error(`WS6 E2E requires disposable DB prefix ${EXPECTED_PREFIX}, got ${dbName}`);
    }
    if (dbName === FORBIDDEN_DB) {
        throw new Error('Persistent test database is forbidden');
    }
    if (!expectedName || dbName !== expectedName) {
        throw new Error(`Disposable DB identity mismatch: url=${dbName} expected=${expectedName || '<missing>'}`);
    }

    return { raw, dbName };
}

async function seedCatalog() {
    await db.insert(schema.Aide).values({
        id: catalog.aideId,
        titre: 'WS6 catalogue aide immuable',
    });

    await db.insert(schema.Structure).values({
        id: catalog.structureId,
        nom: 'WS6 Structure catalogue',
        services: [],
        publics_accueillis: [],
        categories_aidees: [],
    });

    await db.insert(schema.Demarche).values({
        id: catalog.demarcheId,
        titre: 'WS6 démarche catalogue immuable',
    });

    await db.insert(schema.Territory).values({
        id: catalog.territoryId,
        authority: 'INSEE',
        type: 'COMMUNE',
        officialCode: 'WS6-E2E-CATALOG',
    });

    await db.insert(schema.ProRdvService).values({
        id: catalog.serviceId,
        structureId: catalog.structureId,
        name: 'WS6 E2E service',
        durationMinutes: 30,
    });
}

async function seedSubject(prefix, { holdStatus = 'RELEASED', holdTarget = 'subject' } = {}) {
    const subjectId = `${prefix}-subject`;
    const diagnosticId = `${prefix}-diagnostic`;
    const appointmentId = `${prefix}-appointment`;
    const conversationId = `${prefix}-rdv-conversation`;
    const messageId = `${prefix}-rdv-message`;
    const notificationId = `${prefix}-rdv-notification`;
    const operationalConsentId = `${prefix}-operational-consent`;
    const guardianRelationshipId = `${prefix}-guardian`;
    const consentLogId = `${prefix}-consent-log`;
    const historicalDsrId = `${prefix}-historical-dsr`;
    const legalHoldId = `${prefix}-legal-hold`;
    const auditId = `${prefix}-audit`;
    const tokenId = `${prefix}-token`;
    const conversationLogId = `${prefix}-conversation-log`;

    const secrets = {
        password: `${prefix}-password-secret`,
        token: `${prefix}-token-secret`,
        rights: `${prefix}-rights-secret`,
        audit: `${prefix}-audit-payload-secret`,
        legalHoldCreator: `${prefix}-legal-hold-creator-secret`,
        email: `${prefix}@example.test`,
        phone: '+33600000000',
    };

    await db.insert(schema.CitizenUser).values({
        id: subjectId,
        email: secrets.email,
        passwordHash: secrets.password,
        phone: secrets.phone,
    });

    await db.insert(schema.AuthToken).values({
        id: tokenId,
        userId: subjectId,
        type: 'EMAIL_VERIFY',
        tokenHash: secrets.token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await db.insert(schema.ConversationLog).values({
        id: conversationLogId,
        message: `${prefix} private conversation`,
        intent: 'ws6-e2e',
        searchMode: 'rag',
        sourceCount: 1,
        sessionId: subjectId,
        metadata: { proof: 'ws6-disposable-db' },
    });

    await db.insert(schema.SharedDiagnostic).values({
        id: diagnosticId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        situation: { logement: 'private' },
        results: { eligibility: true },
        viewCount: 0,
        rightsSecretHash: secrets.rights,
        privacySubjectId: subjectId,
        subjectType: 'CITIZEN_USER',
    });

    await db.insert(schema.ProAppointment).values({
        id: appointmentId,
        structureId: catalog.structureId,
        serviceId: catalog.serviceId,
        startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        beneficiaryName: `${prefix} Private Beneficiary`,
        beneficiaryPhone: secrets.phone,
        notes: `${prefix} private appointment note`,
        citizenUserId: subjectId,
        citizenEmailSnapshot: secrets.email,
        idempotencyKey: `${prefix}-idempotency`,
    });

    await db.insert(schema.RdvConversation).values({
        id: conversationId,
        appointmentId,
        structureId: catalog.structureId,
        citizenUserId: subjectId,
    });

    await db.insert(schema.RdvConversationMessage).values({
        id: messageId,
        conversationId,
        senderType: 'CITIZEN',
        senderCitizenUserId: subjectId,
        body: `${prefix} private message`,
    });

    await db.insert(schema.RdvNotificationLog).values({
        id: notificationId,
        conversationId,
        messageId,
        recipientType: 'CITIZEN',
    });

    await db.insert(schema.UserConsent).values({
        id: operationalConsentId,
        citizenId: subjectId,
        structureId: catalog.structureId,
        purpose: 'WS6_E2E_OPERATIONAL',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ipAddress: '127.0.0.1',
    });

    await db.insert(schema.GuardianRelationship).values({
        id: guardianRelationshipId,
        minorId: subjectId,
        guardianId: `${prefix}-guardian-principal`,
        status: 'VERIFIED_STRONG',
        scopes: ['VIEW_PROFILE_SCOPE'],
    });

    await db.insert(schema.ConsentLog).values({
        id: consentLogId,
        policy_version: 'ws6-e2e-v1',
        policy_hash: `${prefix}-policy-hash`,
        subject_type: 'CITIZEN_USER',
        subject_id: subjectId,
        purpose: 'ARTICLE9_EXPLICIT_CONSENT',
        decision: true,
        collection_channel: 'WS6_E2E',
        guardian_involved: false,
        proof_level: 'E2E',
    });

    await db.insert(schema.DSRRequest).values({
        id: historicalDsrId,
        subjectType: 'CITIZEN_USER',
        subjectId,
        requestType: 'ACCESS',
        status: 'COMPLETED',
        executionMode: 'AUTOMATIC_SAFE',
        affectedDomains: ['CitizenProfile'],
        completedAt: new Date(),
    });

    const holdRecordId = holdTarget === 'diagnostic' ? diagnosticId : subjectId;
    await db.insert(schema.LegalHold).values({
        id: legalHoldId,
        dataCategory: holdTarget === 'diagnostic' ? 'EligibilitySimulation' : 'CitizenProfile',
        recordId: holdRecordId,
        reasonCode: `${prefix}-hold-reason`,
        createdBy: secrets.legalHoldCreator,
        status: holdStatus,
        releasedAt: holdStatus === 'RELEASED' ? new Date() : null,
    });

    await db.insert(schema.AuditLog).values({
        id: auditId,
        action: 'WS6_E2E_SEEDED_AUDIT',
        actor: 'citizen',
        actor_id: subjectId,
        entity: 'CitizenUser',
        entity_id: subjectId,
        target: subjectId,
        ip: '127.0.0.1',
        details: { forbiddenPersonalPayload: secrets.audit },
    });

    return {
        subjectId,
        diagnosticId,
        appointmentId,
        conversationId,
        messageId,
        notificationId,
        operationalConsentId,
        guardianRelationshipId,
        consentLogId,
        historicalDsrId,
        legalHoldId,
        auditId,
        tokenId,
        conversationLogId,
        secrets,
    };
}

async function findById(tableName, table, id) {
    return db.query[tableName].findFirst({ where: eq(table.id, id) });
}

beforeAll(async () => {
    const { raw, dbName } = requireDisposableDatabaseUrl();

    pool = new Pool({
        connectionString: raw,
        ssl: false,
        max: 4,
    });
    db = drizzle(pool, { schema });

    const identity = await pool.query('SELECT current_database() AS db');
    expect(identity.rows[0]?.db).toBe(dbName);
    expect(identity.rows[0]?.db.startsWith(EXPECTED_PREFIX)).toBe(true);
    expect(identity.rows[0]?.db).not.toBe(FORBIDDEN_DB);

    privacyService = createPrivacyRightsService({ db, cryptoLib: crypto });
    await seedCatalog();
}, 30000);

afterAll(async () => {
    if (pool) await pool.end();
});

describe('WS6 disposable PostgreSQL DSR proof', () => {
    it('exports every implemented user-scoped lineage domain and excludes secrets', async () => {
        const seeded = await seedSubject('ws6-export', {
            holdStatus: 'ACTIVE',
            holdTarget: 'diagnostic',
        });

        const { requestId, exportData } = await privacyService.executeExportRequest(seeded.subjectId);

        expect(requestId).toBeTruthy();
        expect(exportData.profile.id).toBe(seeded.subjectId);
        expect(exportData.profile.passwordHash).toBeUndefined();

        expect(exportData.conversations.map((x) => x.id)).toContain(seeded.conversationLogId);
        expect(exportData.authTokens.map((x) => x.id)).toContain(seeded.tokenId);
        expect(exportData.authTokens[0]?.tokenHash).toBeUndefined();

        expect(exportData.diagnostics.map((x) => x.id)).toContain(seeded.diagnosticId);
        expect(exportData.diagnostics[0]?.rightsSecretHash).toBeUndefined();

        expect(exportData.appointments.map((x) => x.id)).toContain(seeded.appointmentId);
        expect(exportData.rdvConversations.map((x) => x.id)).toContain(seeded.conversationId);
        expect(exportData.rdvMessages.map((x) => x.id)).toContain(seeded.messageId);
        expect(exportData.rdvNotifications.map((x) => x.id)).toContain(seeded.notificationId);
        expect(exportData.operationalConsents.map((x) => x.id)).toContain(seeded.operationalConsentId);
        expect(exportData.guardianRelationships.map((x) => x.id)).toContain(seeded.guardianRelationshipId);
        expect(exportData.consents.map((x) => x.id)).toContain(seeded.consentLogId);
        expect(exportData.dsrRequests.map((x) => x.id)).toContain(seeded.historicalDsrId);
        expect(exportData.legalHolds.map((x) => x.id)).toContain(seeded.legalHoldId);
        expect(exportData.legalHolds[0]?.createdBy).toBeUndefined();
        expect(exportData.auditLogs.map((x) => x.id)).toContain(seeded.auditId);
        expect(exportData.auditLogs[0]?.details).toBeUndefined();
        expect(exportData.auditLogs[0]?.ip).toBeUndefined();

        // RGPD portability/export MUST include the subject's personal data
        // (for example email and phone). Only secrets/authentication material
        // and deliberately non-exportable sensitive audit/legal metadata are forbidden.
        expect(exportData.profile.email).toBe(seeded.secrets.email);
        expect(exportData.profile.phone).toBe(seeded.secrets.phone);

        const serialized = JSON.stringify(exportData);
        for (const forbidden of [
            seeded.secrets.password,
            seeded.secrets.token,
            seeded.secrets.rights,
            seeded.secrets.audit,
            seeded.secrets.legalHoldCreator,
        ]) {
            expect(serialized).not.toContain(String(forbidden));
        }

        const request = await db.query.DSRRequest.findFirst({
            where: eq(schema.DSRRequest.id, requestId),
        });
        expect(request?.status).toBe('COMPLETED');

        const audit = await db.query.AuditLog.findFirst({
            where: and(
                eq(schema.AuditLog.action, 'DSR_EXPORT_COMPLETED'),
                eq(schema.AuditLog.entity_id, requestId),
            ),
        });
        expect(audit).toBeTruthy();
        expect(audit?.actor_id).not.toBe(seeded.subjectId);
        const auditSerialized = JSON.stringify(audit);
        expect(auditSerialized).not.toContain(seeded.secrets.email);
        expect(auditSerialized).not.toContain(seeded.secrets.password);
        expect(auditSerialized).not.toContain(seeded.secrets.token);
        expect(auditSerialized).not.toContain(seeded.secrets.rights);
    }, 30000);

    it('deletes or anonymizes only authorized user-scoped domains and preserves retained/catalog data', async () => {
        const seeded = await seedSubject('ws6-delete', {
            holdStatus: 'RELEASED',
            holdTarget: 'subject',
        });

        await expect(
            privacyService.deleteDataDomains(seeded.subjectId, ['Aide']),
        ).rejects.toMatchObject({ code: 'CATALOG_IMMUNITY' });

        const requested = await privacyService.requestDeletion(seeded.subjectId);
        expect(requested.status).toBe('IN_REVIEW');

        await privacyService.updateDsrRequestStatus(requested.id, 'APPROVED');
        const summary = await privacyService.executeApprovedDeletion(requested.id);

        expect(summary.conversationsDeleted).toBe(1);
        expect(summary.authTokensDeleted).toBe(1);
        expect(summary.diagnosticsDeleted).toBe(1);
        expect(summary.appointmentsAnonymized).toBe(1);
        expect(summary.rdvConversationsDeleted).toBe(1);
        expect(summary.rdvMessagesDeleted).toBe(1);
        expect(summary.rdvNotificationsDeleted).toBe(1);
        expect(summary.operationalConsentsDeleted).toBe(1);
        expect(summary.guardianRelationshipsDeleted).toBe(1);
        expect(summary.profileDeleted).toBe(1);
        expect(summary.retainedDomains).toEqual(
            expect.arrayContaining(['ConsentLog', 'DSRRequest', 'LegalHold', 'AuditLog']),
        );

        expect(await findById('CitizenUser', schema.CitizenUser, seeded.subjectId)).toBeUndefined();
        expect(await findById('AuthToken', schema.AuthToken, seeded.tokenId)).toBeUndefined();
        expect(await findById('ConversationLog', schema.ConversationLog, seeded.conversationLogId)).toBeUndefined();
        expect(await findById('SharedDiagnostic', schema.SharedDiagnostic, seeded.diagnosticId)).toBeUndefined();
        expect(await findById('RdvConversation', schema.RdvConversation, seeded.conversationId)).toBeUndefined();
        expect(await findById('RdvConversationMessage', schema.RdvConversationMessage, seeded.messageId)).toBeUndefined();
        expect(await findById('RdvNotificationLog', schema.RdvNotificationLog, seeded.notificationId)).toBeUndefined();
        expect(await findById('UserConsent', schema.UserConsent, seeded.operationalConsentId)).toBeUndefined();
        expect(await findById('GuardianRelationship', schema.GuardianRelationship, seeded.guardianRelationshipId)).toBeUndefined();

        const appointment = await findById('ProAppointment', schema.ProAppointment, seeded.appointmentId);
        expect(appointment).toMatchObject({
            beneficiaryName: '[anonymisé]',
            beneficiaryPhone: null,
            citizenEmailSnapshot: null,
            notes: null,
            citizenUserId: null,
        });

        expect(await findById('ConsentLog', schema.ConsentLog, seeded.consentLogId)).toBeTruthy();
        expect(await findById('LegalHold', schema.LegalHold, seeded.legalHoldId)).toBeTruthy();
        expect(await findById('AuditLog', schema.AuditLog, seeded.auditId)).toBeTruthy();

        const completedRequest = await findById('DSRRequest', schema.DSRRequest, requested.id);
        expect(completedRequest?.status).toBe('COMPLETED');
        expect(await findById('DSRRequest', schema.DSRRequest, seeded.historicalDsrId)).toBeTruthy();

        expect(await findById('Aide', schema.Aide, catalog.aideId)).toBeTruthy();
        expect(await findById('Structure', schema.Structure, catalog.structureId)).toBeTruthy();
        expect(await findById('Demarche', schema.Demarche, catalog.demarcheId)).toBeTruthy();
        expect(await findById('Territory', schema.Territory, catalog.territoryId)).toBeTruthy();

        const deleteAudit = await db.query.AuditLog.findFirst({
            where: and(
                eq(schema.AuditLog.action, 'DSR_DELETE_COMPLETED'),
                eq(schema.AuditLog.entity_id, requested.id),
            ),
        });
        expect(deleteAudit).toBeTruthy();
        expect(deleteAudit?.actor_id).not.toBe(seeded.subjectId);
        expect(deleteAudit?.details).toMatchObject({
            status: 'COMPLETED',
            requestId: requested.id,
        });

        const deleteAuditSerialized = JSON.stringify(deleteAudit);
        for (const forbidden of [
            seeded.secrets.email,
            seeded.secrets.phone,
            seeded.secrets.password,
            seeded.secrets.token,
            seeded.secrets.rights,
        ]) {
            expect(deleteAuditSerialized).not.toContain(forbidden);
        }
    }, 30000);

    it('blocks erasure when an active LegalHold covers the subject data', async () => {
        const seeded = await seedSubject('ws6-hold', {
            holdStatus: 'ACTIVE',
            holdTarget: 'diagnostic',
        });

        const requested = await privacyService.requestDeletion(seeded.subjectId);
        await privacyService.updateDsrRequestStatus(requested.id, 'APPROVED');

        await expect(
            privacyService.executeApprovedDeletion(requested.id),
        ).rejects.toMatchObject({ code: 'LEGAL_HOLD_ACTIVE' });

        expect(await findById('CitizenUser', schema.CitizenUser, seeded.subjectId)).toBeTruthy();
        expect(await findById('AuthToken', schema.AuthToken, seeded.tokenId)).toBeTruthy();
        expect(await findById('SharedDiagnostic', schema.SharedDiagnostic, seeded.diagnosticId)).toBeTruthy();
        expect(await findById('LegalHold', schema.LegalHold, seeded.legalHoldId)).toBeTruthy();

        const request = await findById('DSRRequest', schema.DSRRequest, requested.id);
        expect(request?.status).toBe('APPROVED');

        const blockedAudit = await db.query.AuditLog.findFirst({
            where: and(
                eq(schema.AuditLog.action, 'DSR_DELETE_BLOCKED_LEGAL_HOLD'),
                eq(schema.AuditLog.entity_id, requested.id),
            ),
        });
        expect(blockedAudit).toBeTruthy();
        expect(blockedAudit?.details).toMatchObject({
            status: 'BLOCKED',
            reasonCode: 'LEGAL_HOLD_ACTIVE',
        });
        expect(blockedAudit?.actor_id).not.toBe(seeded.subjectId);
        expect(JSON.stringify(blockedAudit)).not.toContain(seeded.secrets.email);
        expect(JSON.stringify(blockedAudit)).not.toContain(seeded.secrets.password);
    }, 30000);

    it('fails closed for an unknown subject against the disposable database', async () => {
        await expect(
            privacyService.requestDeletion('ws6-missing-subject'),
        ).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
    });
});
