// @ts-nocheck
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { nextDecisionAt } from '../lib/consent-ledger.js';
import { purgeDossierFiles, storageKeysOf } from './dossier-files.js';
import {
    CitizenUser,
    AuthToken,
    ConversationLog,
    ProAppointment,
    SharedDiagnostic,
    ConsentLog,
    GuardianRelationship,
    DSRRequest,
    LegalHold,
    AuditLog,
    RdvConversation,
    RdvMessageAttachment,
    RdvConversationMessage,
    RdvNotificationLog,
    UserConsent,
    CitizenProfile,
    HouseholdMember,
    NotificationPreference,
    ParcoursItem,
    ParcoursEvent,
    CitizenFavorite,
    CitizenHistoryEntry,
    CitizenDocument,
    CitizenDelegation,
    DelegationAccessEvent
} from '../../src/db/schema.js';

export const PURPOSE_REGISTRY = {
    MARKETING_EMAIL: { defaultOff: true, requiresConsent: true },
    MARKETING_SMS: { defaultOff: true, requiresConsent: true },
    TELEPHONE_PROSPECTING: { defaultOff: true, requiresConsent: true },
    PRECISE_GEOLOCATION: { defaultOff: true, requiresConsent: true },
    ANALYTICS_NON_EXEMPT: { defaultOff: true, requiresConsent: true },
    AI_EXTERNAL_PROCESSING: { defaultOff: true, requiresConsent: true },
    PROFESSIONAL_DOSSIER_SHARING: { defaultOff: true, requiresConsent: true },
    ARTICLE9_EXPLICIT_CONSENT: { defaultOff: true, requiresConsent: true },
    DOCUMENT_PROCESSING: { defaultOff: true, requiresConsent: true }
};

export const RETENTION_POLICY_REGISTRY = {
    // PKG-5 (2026-10-21): every entry states whether a job really applies it. The registry used to say AUDIT_LOG / CONSENT_LOG were never deleted automatically while
    // cron/gdpr-purge deletes them after 365 / 1095 days (values locked by tests); the registry now describes the implemented behaviour, still flagged for the DPO.
    INACTIVE_ACCOUNT: { durationDays: 730, type: 'ADA_PRODUCT_POLICY', action: 'DELETE_OR_ANONYMIZE', requiresReview: false, implementedBy: null },   // NOT applied by any job yet (stated in the privacy policy as planned)
    CONSENT_LOG: { durationDays: 1095, type: 'ADA_PRODUCT_POLICY_PENDING_DPO', action: 'DELETE', requiresReview: true, implementedBy: 'cron/gdpr-purge', note: 'preuve du consentement : 3 ans ; la prescription civile de droit commun est de 5 ans (code civil art. 2224) — à arbitrer par le DPO ; seules les décisions remplacées sont supprimées : la dernière décision de chaque personne pour chaque finalité est conservée' },
    AUDIT_LOG: { durationDays: 365, type: 'CNIL_RECOMMENDATION_LOGGING', action: 'DELETE', requiresReview: true, implementedBy: 'cron/gdpr-purge', note: 'journalisation : la CNIL recommande 6 mois à 1 an (délibération 2021-122) ; une conservation légale (LegalHold) doit primer' },
    SHARED_DIAGNOSTIC: { durationDays: 90, type: 'CURRENT_ADA_TECHNICAL_OR_PRODUCT_POLICY', action: 'DELETE', requiresReview: false, implementedBy: 'cron/gdpr-purge (respects LegalHold)' },
    STATUTORY_UNKNOWN: { durationDays: null, type: 'UNRESOLVED_LEGAL_REVIEW', action: 'AUTOMATED_DELETION_DISABLED', requiresReview: true }
};

export const GUARDIAN_CAPABILITY_POLICY = {
    LOW_RISK_INFORMATIONAL: ['VIEW_PROFILE_SCOPE'],
    MEDIUM_RISK_PERSONALISATION: ['VIEW_DIAGNOSTIC_SCOPE', 'VIEW_DOCUMENT_SCOPE'],
    HIGH_RISK_SENSITIVE_DATA_ACCESS: ['MANAGE_CONSENT_SCOPE', 'SHARE_DOSSIER_SCOPE', 'REQUEST_DSR_SCOPE'],
    HIGH_IMPACT_EXTERNAL_ACTION: ['HIGH_IMPACT_ACTION_SCOPE']
};

export const PRIVACY_DATA_DOMAIN_REGISTRY = [
    'CitizenUser',
    'ConversationLog',
    'ProAppointment',
    'AuthToken',
    'SharedDiagnostic',
    'ConsentLog',
    'DSRRequest',
    'LegalHold',
    'AuditLog'
];

export const DSR_EXECUTION_POLICY = {
    ACCESS: 'AUTOMATIC_SAFE',
    EXPORT: 'AUTOMATIC_SAFE',
    DELETE: 'HUMAN_REVIEW_REQUIRED',
    RESTRICT: 'HUMAN_REVIEW_REQUIRED',
    OBJECT: 'HUMAN_REVIEW_REQUIRED',
    WITHDRAW_CONSENT: 'AUTOMATIC_SAFE'
};

export const USER_PERSONAL_DATA_LINEAGE = Object.freeze({
    CitizenProfile: {
        action: 'DELETE',
        // PKG-1: profile, household and notification preferences are deleted with the account (ON DELETE CASCADE from CitizenUser) and included in the export.
        // PKG-2: Mon Parcours (+ history), favourites, opt-in history and Mon Coffre rows cascade the same way; the Coffre's encrypted blobs are purged after commit.
        storageEntities: ['CitizenUser', 'CitizenProfile', 'HouseholdMember', 'NotificationPreference', 'ParcoursItem', 'ParcoursEvent', 'CitizenFavorite', 'CitizenHistoryEntry', 'CitizenDocument', 'CitizenDelegation', 'DelegationAccessEvent']
    },
    CitizenSession: {
        action: 'DELETE',
        storageEntities: ['AuthToken', 'ConversationLog']
    },
    DocumentUpload: {
        action: 'DELETE',
        storageEntities: [],
        implementedInCurrentSchema: false
    },
    TelemetryRecord: {
        action: 'ANONYMIZE',
        storageEntities: [],
        implementedInCurrentSchema: false
    },
    EligibilitySimulation: {
        action: 'DELETE',
        storageEntities: ['SharedDiagnostic']
    },
    CitizenAppointment: {
        action: 'ANONYMIZE',
        storageEntities: ['ProAppointment']
    },
    CitizenMessaging: {
        action: 'DELETE',
        storageEntities: ['RdvConversation', 'RdvConversationMessage', 'RdvMessageAttachment', 'RdvNotificationLog']
    },
    OperationalConsent: {
        action: 'DELETE',
        storageEntities: ['UserConsent']
    },
    GuardianRelationship: {
        action: 'DELETE',
        storageEntities: ['GuardianRelationship']
    },
    ConsentLog: {
        action: 'RETAIN_WITH_LEGAL_BASIS',
        storageEntities: ['ConsentLog']
    },
    DSRRequest: {
        action: 'RETAIN_WITH_LEGAL_BASIS',
        storageEntities: ['DSRRequest']
    },
    LegalHold: {
        action: 'RETAIN_WITH_LEGAL_BASIS',
        storageEntities: ['LegalHold']
    },
    AuditLog: {
        action: 'RETAIN_WITH_LEGAL_BASIS',
        storageEntities: ['AuditLog']
    },
    Aide: {
        action: 'NOT_USER_SCOPED',
        storageEntities: ['Aide']
    },
    Structure: {
        action: 'NOT_USER_SCOPED',
        storageEntities: ['Structure']
    },
    Demarche: {
        action: 'NOT_USER_SCOPED',
        storageEntities: ['Demarche']
    },
    Territory: {
        action: 'NOT_USER_SCOPED',
        storageEntities: ['Territory']
    }
});

const ERASABLE_DOMAINS = Object.freeze([
    'CitizenSession',
    'EligibilitySimulation',
    'CitizenAppointment',
    'CitizenMessaging',
    'OperationalConsent',
    'GuardianRelationship',
    'CitizenProfile'
]);

/**
 * @param {string} code
 * @param {string | undefined} message
 */
function privacyError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/**
 * @param {readonly string[]} value
 */
function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
* @param {string[]} keys
*/
function stripKeys(/** @type {Record<string, string | number | boolean | null | undefined>} */ record, keys) {
    if (!record || typeof record !== 'object') return record;
    const clone = { ...record };
    for (const key of keys) delete clone[key];
    return clone;
}

function subjectFingerprint(cryptoLib, /** @type {unknown} */ subjectId) {
    return cryptoLib.createHash('sha256').update(String(subjectId)).digest('hex');
}

async function safeFindMany(/** @type {{ findMany: unknown }} */ queryApi, /** @type {unknown} */ options) {
    if (!queryApi || typeof queryApi.findMany !== 'function') return [];
    try {
        return safeArray(await queryApi.findMany(options));
    } catch {
        return [];
    }
}

/**
* @param {{ query: { ConversationLog: { findMany: unknown; }; ProAppointment: { findMany: unknown; }; AuthToken: { findMany: unknown; }; SharedDiagnostic: { findMany: unknown; }; ConsentLog: { findMany: unknown; }; DSRRequest: { findMany: unknown; }; RdvConversation: { findMany: unknown; }; UserConsent: { findMany: unknown; }; GuardianRelationship: { findMany: unknown; }; RdvConversationMessage: { findMany: unknown; }; RdvNotificationLog: { findMany: unknown; }; }; }} database
* @param {any} subjectId
*/
async function collectSubjectRecords(database, subjectId) {
    const [
        conversations,
        appointments,
        tokens,
        diagnostics,
        consents,
        dsrRequests,
        rdvConversations,
        operationalConsents,
        guardianRelationships
    ] = await Promise.all([
        safeFindMany(database.query?.ConversationLog, { where: eq(ConversationLog.sessionId, subjectId) }),
        safeFindMany(database.query?.ProAppointment, { where: eq(ProAppointment.citizenUserId, subjectId) }),
        safeFindMany(database.query?.AuthToken, { where: eq(AuthToken.userId, subjectId) }),
        safeFindMany(database.query?.SharedDiagnostic, { where: eq(SharedDiagnostic.privacySubjectId, subjectId) }),
        safeFindMany(database.query?.ConsentLog, { where: eq(ConsentLog.subject_id, subjectId) }),
        safeFindMany(database.query?.DSRRequest, { where: eq(DSRRequest.subjectId, subjectId) }),
        safeFindMany(database.query?.RdvConversation, { where: eq(RdvConversation.citizenUserId, subjectId) }),
        safeFindMany(database.query?.UserConsent, { where: eq(UserConsent.citizenId, subjectId) }),
        safeFindMany(database.query?.GuardianRelationship, {
            where: or(
                eq(GuardianRelationship.minorId, subjectId),
                eq(GuardianRelationship.guardianId, subjectId)
            )
        })
    ]);

    const rdvMessages = [];
    const rdvNotifications = [];
    for (const conversation of rdvConversations) {
        const [messages, notifications] = await Promise.all([
            safeFindMany(database.query?.RdvConversationMessage, {
                where: eq(RdvConversationMessage.conversationId, conversation.id)
            }),
            safeFindMany(database.query?.RdvNotificationLog, {
                where: eq(RdvNotificationLog.conversationId, conversation.id)
            })
        ]);
        rdvMessages.push(...messages);
        rdvNotifications.push(...notifications);
    }

    return {
        conversations,
        appointments,
        tokens,
        diagnostics,
        consents,
        dsrRequests,
        rdvConversations,
        rdvMessages,
        rdvNotifications,
        operationalConsents,
        guardianRelationships
    };
}

/**
* @param {Iterable<any> | null | undefined} domains
*/
function affectedRecordIds(/** @type {unknown} */ subjectId, /** @type {{ appointments: unknown, conversations: unknown, diagnostics: unknown, guardianRelationships: unknown, operationalConsents: unknown, rdvConversations: unknown, rdvMessages: unknown, rdvNotifications: unknown, tokens: unknown }} */ records, domains) {
    const ids = new Set([String(subjectId)]);
    const requested = new Set(domains);

    // @ts-ignore
    const addIds = (items) => {
        for (const item of items) {
            if (item?.id) ids.add(String(item.id));
        }
    };

    if (requested.has('CitizenSession')) {
        addIds(records.conversations);
        addIds(records.tokens);
    }
    if (requested.has('EligibilitySimulation')) addIds(records.diagnostics);
    if (requested.has('CitizenAppointment')) addIds(records.appointments);
    if (requested.has('CitizenMessaging')) {
        addIds(records.rdvConversations);
        addIds(records.rdvMessages);
        addIds(records.rdvNotifications);
    }
    if (requested.has('OperationalConsent')) addIds(records.operationalConsents);
    if (requested.has('GuardianRelationship')) addIds(records.guardianRelationships);

    return ids;
}

/**
* @param {{ query: { LegalHold: { findMany: unknown; }; }; }} database
* @param {Set<string>} recordIds
*/
async function findActiveLegalHolds(database, recordIds) {
    const holds = await safeFindMany(database.query?.LegalHold, {
        where: eq(LegalHold.status, 'ACTIVE')
    });
    return holds.filter((hold) => recordIds.has(String(hold?.recordId)));
}

// @ts-ignore
async function writeDsrAudit(database, /** @type {string | number | boolean | null | undefined} */ cryptoLib, {
    // @ts-ignore
    action,
    // @ts-ignore
    subjectId,
    requestId = null,
    // @ts-ignore
    status,
    // @ts-ignore
    domains = [],
    reasonCode = null
}) {
    const details = {
        status,
        requestId,
        domains: [...domains].sort(),
        reasonCode
    };

    await database.insert(AuditLog).values({
        action,
        actor: 'citizen',
        actor_id: subjectFingerprint(cryptoLib, subjectId),
        entity: 'DSR',
        entity_id: requestId,
        target: 'privacy-subject',
        details
    });

    return details;
}

/**
* @param {{ (tx: any): Promise<{ conversationsDeleted: number; authTokensDeleted: number; diagnosticsDeleted: number; appointmentsAnonymized: number; rdvConversationsDeleted: number; rdvMessagesDeleted: number; rdvNotificationsDeleted: number; operationalConsentsDeleted: number; guardianRelationshipsDeleted: number; profileDeleted: number; retainedDomains: string[]; }>; (arg0: { transaction: unknown; }): any; }} fn
*/
async function executeWithTransaction(/** @type {{ transaction: unknown }} */ database, fn) {
    if (typeof database.transaction === 'function') {
        return database.transaction(fn);
    }
    return fn(database);
}

// @ts-ignore
export function createPrivacyRightsService({ db, cryptoLib }) {
    return {
        /**
       * @param {string | import("drizzle-orm").SQLWrapper} userId
       */
        async getExportData(userId) {
            const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.id, userId) });
            if (!user) return null;

            const records = await collectSubjectRecords(db, userId);
            const recordIds = affectedRecordIds(userId, records, ERASABLE_DOMAINS);
            const allHolds = await safeFindMany(db.query?.LegalHold, {
                where: eq(LegalHold.status, 'ACTIVE')
            });
            const relevantHolds = allHolds.filter((hold) => recordIds.has(String(hold?.recordId)));

            const fingerprint = subjectFingerprint(cryptoLib, userId);
            const auditLogs = await safeFindMany(db.query?.AuditLog, {
                where: or(
                    eq(AuditLog.actor_id, userId),
                    eq(AuditLog.actor_id, fingerprint),
                    eq(AuditLog.target, userId),
                    eq(AuditLog.entity_id, userId)
                ),
                columns: {
                    id: true,
                    action: true,
                    actor: true,
                    target: true,
                    timestamp: true,
                    actor_id: true,
                    entity: true,
                    entity_id: true
                }
            });

            const accountProfile = await safeFindMany(db.query?.CitizenProfile, { where: eq(CitizenProfile.userId, userId) });
            const household = await safeFindMany(db.query?.HouseholdMember, { where: eq(HouseholdMember.userId, userId) });
            const notificationPreferences = await safeFindMany(db.query?.NotificationPreference, { where: eq(NotificationPreference.userId, userId) });
            // PKG-2: everything Mon Espace keeps about the person (the Coffre is listed as metadata: the documents themselves are downloaded from Mon Coffre; no storage key is exported)
            const parcours = await safeFindMany(db.query?.ParcoursItem, { where: eq(ParcoursItem.userId, userId) });
            const parcoursHistory = await safeFindMany(db.query?.ParcoursEvent, { where: eq(ParcoursEvent.userId, userId) });
            const favorites = await safeFindMany(db.query?.CitizenFavorite, { where: eq(CitizenFavorite.userId, userId) });
            const history = await safeFindMany(db.query?.CitizenHistoryEntry, { where: eq(CitizenHistoryEntry.userId, userId) });
            const coffreDocuments = (await safeFindMany(db.query?.CitizenDocument, { where: eq(CitizenDocument.userId, userId) })).map((d) => stripKeys(d, ['storageKey', 'filenameEncrypted']));
            // PKG-2 / C23: delegations given and received (no invitation token hash) and the log of what delegates viewed
            const delegationsGiven = (await safeFindMany(db.query?.CitizenDelegation, { where: eq(CitizenDelegation.principalUserId, userId) })).map((d) => stripKeys(d, ['inviteTokenHash']));
            const delegationsReceived = (await safeFindMany(db.query?.CitizenDelegation, { where: eq(CitizenDelegation.delegateUserId, userId) })).map((d) => stripKeys(d, ['inviteTokenHash']));
            const delegationAccess = await safeFindMany(db.query?.DelegationAccessEvent, { where: eq(DelegationAccessEvent.principalUserId, userId) });
            // PKG-4: follow-ups and referrals of the person's dossiers (status, outcome, the summary and notes written FOR the person).
            // Organizations' INTERNAL notes may contain personal data about the person: they are NOT released automatically (they can also concern third parties and the
            // organization's own assessment), but they are NOT silently excluded either — they are listed below as organization-held records awaiting a HUMAN review,
            // and the request is then recorded as PARTIALLY_COMPLETED with an ACCESS_REVIEW request (never "completed" while that review is open).
            const safeRows = async (q) => { try { return (await db.execute(q)).rows || []; } catch { return []; } };
            const caseFollowUps = await safeRows(sql`SELECT c."sharedDiagnosticId" AS "dossierId", s.nom AS organization, c.status, c.outcome, c."outcomeCitizenSummary" AS summary, c."openedAt", c."closedAt"
              FROM "ProCase" c JOIN "SharedDiagnostic" d ON d.id = c."sharedDiagnosticId" JOIN "Structure" s ON s.id = c."structureId" WHERE d."ownerCitizenId" = ${userId}`);
            const referrals = await safeRows(sql`SELECT r."sharedDiagnosticId" AS "dossierId", sf.nom AS "from", st.nom AS "to", r.status, r."reasonCode", r.outcome, r."outcomeCitizenSummary" AS summary, r."createdAt", r."citizenDecisionAt"
              FROM "Referral" r JOIN "SharedDiagnostic" d ON d.id = r."sharedDiagnosticId" JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId" WHERE d."ownerCitizenId" = ${userId}`);
            const internalNotes = await safeRows(sql`SELECT s.nom AS organization, count(*)::int AS count FROM "ProCaseNote" n JOIN "ProCase" c ON c.id = n."caseId"
              JOIN "SharedDiagnostic" d ON d.id = c."sharedDiagnosticId" JOIN "Structure" s ON s.id = c."structureId" WHERE d."ownerCitizenId" = ${userId} AND n.visibility = 'INTERNAL' GROUP BY s.nom ORDER BY s.nom`);
            const { releasedExtract } = await import('./dsr-review.js');
            const reviews = (await safeRows(sql`SELECT id, status, "createdAt", "completedAt", "reviewOutcome" AS outcome
              FROM "DSRRequest" WHERE "subjectId" = ${userId} AND "requestType" = 'ACCESS_REVIEW' ORDER BY "createdAt" DESC`))
              .map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, completedAt: r.completedAt, decision: r.outcome?.decision || null, decidedAt: r.outcome?.decidedAt || null,
                basis: r.outcome?.basis || null, releasedExtract: releasedExtract(r.id, r.outcome) }));   // the reviewer's identity stays internal
            const organizationHeldRecords = {
                internalCaseNotes: internalNotes,
                status: internalNotes.length ? 'PENDING_HUMAN_REVIEW' : 'NONE',
                explanation: internalNotes.length
                    ? 'Des notes internes des structures qui vous accompagnent vous concernent. Elles ne sont pas transmises automatiquement : elles doivent être examinées par une personne habilitée (informations concernant des tiers, restrictions applicables). Votre demande reste ouverte pour cette partie.'
                    : 'Aucune note interne de structure ne vous concerne.',
                reviews,
            };
            const rdvMessageAttachments = (await safeRows(sql`SELECT a.id, a."conversationId", a."messageId", a."uploaderType", a."mimeType", a."byteLength", a."createdAt"
              FROM "RdvMessageAttachment" a JOIN "RdvConversation" c ON c.id = a."conversationId" WHERE c."citizenUserId" = ${userId}`));
            // PKG-11 audit (art. 15 completeness): the person's own dossiers also carry the conversation threads with organizations (every message, decrypted),
            // the accesses given to organizations (grants and invitations — no token hash) and the per-dossier purpose consents; they were missing from the export
            const dossierThreads = [];
            for (const t of await safeRows(sql`SELECT t.id, t."sharedDiagnosticId" AS "dossierId", s.nom AS organization, t."createdAt", t."lastMessageAt"
              FROM "SharedDossierThread" t JOIN "SharedDiagnostic" d ON d.id = t."sharedDiagnosticId" JOIN "Structure" s ON s.id = t."structureId" WHERE d."ownerCitizenId" = ${userId}`)) {
                const { openMessage } = await import('./shared-dossier-threads.js');
                const msgs = await safeRows(sql`SELECT id, "senderType", body, "createdAt" FROM "SharedDossierMessage" WHERE "threadId" = ${t.id} ORDER BY "createdAt"`);
                dossierThreads.push({ ...t, messages: msgs.map((m) => ({ id: m.id, from: m.senderType, text: (() => { try { return openMessage(t.id, m.body); } catch { return null; } })(), createdAt: m.createdAt })) });
            }
            const dossierAccesses = await safeRows(sql`SELECT g."sharedDiagnosticId" AS "dossierId", s.nom AS organization, g."grantedVia", g.purposes, g."purposesUpdatedAt", g."createdAt", g."revokedAt"
              FROM "SharedDossierGrant" g JOIN "SharedDiagnostic" d ON d.id = g."sharedDiagnosticId" JOIN "Structure" s ON s.id = g."structureId" WHERE d."ownerCitizenId" = ${userId}`);
            const dossierInvitations = await safeRows(sql`SELECT i."sharedDiagnosticId" AS "dossierId", s.nom AS organization, i.purpose, i."createdAt", i."expiresAt", i."usedAt", i."revokedAt"
              FROM "SharedDossierInvite" i JOIN "SharedDiagnostic" d ON d.id = i."sharedDiagnosticId" LEFT JOIN "Structure" s ON s.id = i."structureId" WHERE d."ownerCitizenId" = ${userId}`);
            const dossierPurposeConsents = await safeRows(sql`SELECT c.subject_id AS "dossierAndOrganization", c.purpose, c.decision, c.created_at AS "decidedAt", c.withdrawn_at AS "withdrawnAt"
              FROM "ConsentLog" c WHERE c.subject_type = 'SHARED_DOSSIER_GRANT' AND split_part(c.subject_id, ':', 1) IN (SELECT id FROM "SharedDiagnostic" WHERE "ownerCitizenId" = ${userId}) ORDER BY c.created_at`);
            const userProfile = stripKeys(user, ['passwordHash']);
            const authTokens = records.tokens.map((token) => stripKeys(token, ['tokenHash']));
            const diagnostics = records.diagnostics.map((diagnostic) => stripKeys(diagnostic, ['rightsSecretHash', 'shareTokenHash']));
            const legalHolds = relevantHolds.map((hold) => stripKeys(hold, ['createdBy']));

            return {
                exportInfo: {
                    exportedAt: new Date().toISOString(),
                    userId,
                    format: 'RGPD Article 20',
                    lineageVersion: 'WS6_USER_PERSONAL_DATA_LINEAGE_V1'
                },
                profile: userProfile,
                accountProfile,
                household,
                notificationPreferences,
                parcours,
                parcoursHistory,
                favorites,
                history,
                coffreDocuments,
                delegationsGiven,
                delegationsReceived,
                delegationAccess,
                caseFollowUps,
                referrals,
                organizationHeldRecords,
                rdvMessageAttachments,
                dossierThreads,
                dossierAccesses,
                dossierInvitations,
                dossierPurposeConsents,
                conversations: records.conversations,
                appointments: records.appointments,
                rdvConversations: records.rdvConversations,
                rdvMessages: records.rdvMessages,
                rdvNotifications: records.rdvNotifications,
                operationalConsents: records.operationalConsents,
                guardianRelationships: records.guardianRelationships,
                authTokens,
                diagnostics,
                consents: records.consents,
                // PKG-4: a human review's internal fields (reviewer identity, encrypted extract) never leave ADA; the decision and the released extract are in organizationHeldRecords
                dsrRequests: (records.dsrRequests || []).map((r) => (r && r.reviewOutcome ? { ...r, reviewOutcome: { decision: r.reviewOutcome.decision || null, decidedAt: r.reviewOutcome.decidedAt || null } } : r)),
                legalHolds,
                auditLogs
            };
        },

        /**
       * @param {string | import("drizzle-orm").SQLWrapper} userId
       */
        async executeExportRequest(userId) {
            const exportData = await this.getExportData(userId);
            if (!exportData) {
                throw privacyError('SUBJECT_NOT_FOUND', 'Privacy subject could not be resolved');
            }

            const [request] = await this.createDsrRequest(
                'CITIZEN_USER',
                userId,
                'EXPORT',
                DSR_EXECUTION_POLICY.EXPORT,
                Object.keys(exportData).filter((key) => key !== 'exportInfo')
            );

            if (!request?.id) {
                throw privacyError('DSR_REQUEST_NOT_CREATED', 'DSR export request could not be created');
            }

            await this.updateDsrRequestStatus(request.id, 'IDENTITY_OR_AUTHORITY_CHECK');
            await this.updateDsrRequestStatus(request.id, 'APPROVED');
            await this.updateDsrRequestStatus(request.id, 'EXECUTING');
            // PKG-4: organization-held records awaiting a human review => the access request is PARTIALLY completed, and one ACCESS_REVIEW request (re-used while open)
            // carries that part to a reviewer. Nothing is decided here.
            const pendingReview = exportData.organizationHeldRecords?.status === 'PENDING_HUMAN_REVIEW';
            const finalStatus = pendingReview ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
            await this.updateDsrRequestStatus(request.id, finalStatus);
            let reviewRequestId = null;
            if (pendingReview) {
                const open = await db.execute(sql`SELECT id FROM "DSRRequest" WHERE "subjectId" = ${userId} AND "requestType" = 'ACCESS_REVIEW' AND status IN ('RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW') LIMIT 1`).catch(() => ({ rows: [] }));
                reviewRequestId = open.rows?.[0]?.id || null;
                if (!reviewRequestId) {
                    const [review] = await this.createDsrRequest('CITIZEN_USER', userId, 'ACCESS_REVIEW', 'HUMAN_REVIEW_REQUIRED', ['ProCaseNote']);
                    reviewRequestId = review?.id || null;
                    if (reviewRequestId) { await this.updateDsrRequestStatus(reviewRequestId, 'IDENTITY_OR_AUTHORITY_CHECK'); await this.updateDsrRequestStatus(reviewRequestId, 'IN_REVIEW'); }
                }
                exportData.organizationHeldRecords.reviewRequestId = reviewRequestId;
            }
            exportData.exportInfo.completeness = finalStatus;

            await writeDsrAudit(db, cryptoLib, {
                action: pendingReview ? 'DSR_EXPORT_PARTIAL_PENDING_REVIEW' : 'DSR_EXPORT_COMPLETED',
                subjectId: userId,
                requestId: request.id,
                status: finalStatus,
                domains: Object.keys(exportData).filter((key) => key !== 'exportInfo')
            });

            return { requestId: request.id, exportData, reviewRequestId };
        },

        hashRightsSecret(/** @type {string | number | boolean | null | undefined} */ rawRightsSecret) {
            return cryptoLib.createHash('sha256').update(rawRightsSecret).digest('hex');
        },

        async generateGuestRightsSecret() {
            return cryptoLib.randomBytes(32).toString('hex');
        },

        async resolveGuestRights(/** @type {string} */ diagnosticId, /** @type {string | number | boolean | null | undefined} */ rawRightsSecret) {
            const hash = this.hashRightsSecret(rawRightsSecret);
            const diagnostic = await db.query.SharedDiagnostic.findFirst({
                where: and(
                    eq(SharedDiagnostic.id, diagnosticId),
                    eq(SharedDiagnostic.rightsSecretHash, hash)
                )
            });
            return diagnostic ? diagnostic : null;
        },

        async verifyGuardianScope(/** @type {string} */ minorId, /** @type {string} */ guardianId, /** @type {string | number | boolean | null | undefined} */ requestedScope, requiredRiskLevel = 'LOW_RISK_INFORMATIONAL') {
            const rel = await db.query.GuardianRelationship.findFirst({
                where: and(
                    eq(GuardianRelationship.minorId, minorId),
                    eq(GuardianRelationship.guardianId, guardianId)
                )
            });
            if (!rel || rel.status === 'REVOKED' || rel.status === 'EXPIRED' || rel.status === 'DISPUTED') {
                return false;
            }
            if (!rel.scopes.includes(requestedScope)) {
                return false;
            }
            if (requiredRiskLevel === 'HIGH_RISK_SENSITIVE_DATA_ACCESS' && rel.status !== 'VERIFIED_STRONG') {
                return false;
            }
            return true;
        },

        async grantConsent(/** @type {string | number | boolean | null | undefined} */ subjectType, /** @type {string | number | boolean | null | undefined} */ subjectId, /** @type {string | number | boolean | null | undefined} */ purpose, /** @type {string | number | boolean | null | undefined} */ policyVersion, /** @type {string | number | boolean | null | undefined} */ collectionChannel, /** @type {string | number | boolean | null | undefined} */ guardianInvolved, /** @type {string | number | boolean | null | undefined} */ proofLevel) {
            return db.insert(ConsentLog).values({
                subject_type: subjectType,
                subject_id: subjectId,
                purpose,
                decision: true,
                policy_version: policyVersion,
                policy_hash: cryptoLib.createHash('sha256').update(`${policyVersion}:${purpose}`).digest('hex'),
                created_at: nextDecisionAt(String(subjectType), String(subjectId), purpose == null ? null : String(purpose)),
                collection_channel: collectionChannel,
                guardian_involved: guardianInvolved,
                proof_level: proofLevel
            }).returning();
        },

        /**
         * @param {string | import("drizzle-orm").SQLWrapper} subjectId
         * @param {string | import("drizzle-orm").SQLWrapper} purpose
         */
        async withdrawConsent(subjectId, purpose) {
            // PKG-11 / C22: the ledger is append-only (trigger ConsentLog_append_only, drizzle/0030): a withdrawal is a NEW decision row; the grant it ends
            // stays as recorded (before: every row of the subject/purpose was rewritten to decision=false, erasing the proof of the earlier grant).
            const [last] = await db.select().from(ConsentLog).where(and(eq(ConsentLog.subject_id, subjectId), eq(ConsentLog.purpose, purpose)))
                .orderBy(desc(ConsentLog.created_at)).limit(1);
            if (last && last.decision === false) return [last];   // already withdrawn: idempotent, no duplicate decision
            return db.insert(ConsentLog).values({
                subject_type: last?.subject_type || 'citizen',
                subject_id: subjectId,
                purpose,
                decision: false,
                withdrawn_at: new Date(),
                created_at: nextDecisionAt(String(last?.subject_type || 'citizen'), String(subjectId), purpose == null ? null : String(purpose)),
                policy_version: last?.policy_version || 'withdrawal',
                policy_hash: last?.policy_hash || cryptoLib.createHash('sha256').update(`withdrawal:${purpose}`).digest('hex'),
                collection_channel: last?.collection_channel || null,
                proof_level: last?.proof_level || null
            }).returning();
        },

        /**
         * @param {string | import("drizzle-orm").SQLWrapper} subjectId
         * @param {string | import("drizzle-orm").SQLWrapper} purpose
         */
        async getCurrentConsent(subjectId, purpose) {
            return db.query.ConsentLog.findFirst({
                where: and(eq(ConsentLog.subject_id, subjectId), eq(ConsentLog.purpose, purpose)),
                // @ts-ignore
                orderBy: (/** @type {{ created_at: string | number | boolean | null | undefined }} */ c, { desc }) => [desc(c.created_at)]
            });
        },

        /**
         * @param {string} subjectType
         * @param {string | import("drizzle-orm").SQLWrapper} subjectId
         * @param {string} requestType
         * @param {string} executionMode
         * @param {readonly string[]} affectedDomains
         */
        async createDsrRequest(subjectType, subjectId, requestType, executionMode, affectedDomains) {
            return db.insert(DSRRequest).values({
                subjectType,
                subjectId,
                requestType,
                executionMode,
                status: 'RECEIVED',
                affectedDomains
            }).returning();
        },

        // @ts-ignore
        async updateDsrRequestStatus(/** @type {string} */ requestId, status) {
            const allowedTransitions = {
                RECEIVED: ['IDENTITY_OR_AUTHORITY_CHECK', 'REJECTED_WITH_REASON'],
                IDENTITY_OR_AUTHORITY_CHECK: ['IN_REVIEW', 'APPROVED', 'REJECTED_WITH_REASON'],
                IN_REVIEW: ['APPROVED', 'REJECTED_WITH_REASON'],
                APPROVED: ['EXECUTING'],
                EXECUTING: ['COMPLETED', 'PARTIALLY_COMPLETED']
            };
            const current = await db.query.DSRRequest.findFirst({ where: eq(DSRRequest.id, requestId) });
            if (!current) return null;
            // @ts-ignore
            if (!allowedTransitions[current.status] || !allowedTransitions[current.status].includes(status)) {
                throw privacyError('INVALID_DSR_TRANSITION', `Invalid DSR transition: ${current.status} -> ${status}`);
            }
            const patch = { status };
            if (status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED') {
                patch.completedAt = new Date();
            }
            return db.update(DSRRequest).set(patch).where(eq(DSRRequest.id, requestId)).returning();
        },

        /**
         * @param {string | import("drizzle-orm").SQLWrapper} userId
         */
        async requestDeletion(userId) {
            const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.id, userId) });
            if (!user) {
                throw privacyError('SUBJECT_NOT_FOUND', 'Privacy subject could not be resolved');
            }

            const [request] = await this.createDsrRequest(
                'CITIZEN_USER',
                userId,
                'DELETE',
                DSR_EXECUTION_POLICY.DELETE,
                ERASABLE_DOMAINS
            );

            if (!request?.id) {
                throw privacyError('DSR_REQUEST_NOT_CREATED', 'DSR deletion request could not be created');
            }

            await this.updateDsrRequestStatus(request.id, 'IDENTITY_OR_AUTHORITY_CHECK');
            const [inReview] = await this.updateDsrRequestStatus(request.id, 'IN_REVIEW');

            await writeDsrAudit(db, cryptoLib, {
                action: 'DSR_DELETE_REQUESTED',
                subjectId: userId,
                requestId: request.id,
                status: 'IN_REVIEW',
                domains: ERASABLE_DOMAINS
            });

            return inReview || { ...request, status: 'IN_REVIEW' };
        },

        /**
         * @param {string | import("drizzle-orm").SQLWrapper} subjectId
         * @param {readonly string[]} domainArray
         */
        async deleteDataDomains(subjectId, domainArray, { requestId = null } = {}) {
            const domains = [...new Set(safeArray(domainArray))];
            if (domains.length === 0) {
                throw privacyError('EMPTY_DSR_DOMAIN_SET', 'No DSR data domain was requested');
            }

            for (const domain of domains) {
                // @ts-ignore
                const lineage = USER_PERSONAL_DATA_LINEAGE[domain];
                if (!lineage) {
                    throw privacyError('UNKNOWN_DSR_DOMAIN', `Unknown DSR domain: ${domain}`);
                }
                if (lineage.action === 'NOT_USER_SCOPED') {
                    throw privacyError('CATALOG_IMMUNITY', `Reference catalog domain cannot be erased: ${domain}`);
                }
                if (lineage.action === 'RETAIN_WITH_LEGAL_BASIS') {
                    throw privacyError('LEGAL_RETENTION_REQUIRED', `Legally retained domain cannot be erased: ${domain}`);
                }
                if (!ERASABLE_DOMAINS.includes(domain)) {
                    throw privacyError('UNIMPLEMENTED_DSR_DOMAIN', `DSR domain has no current storage implementation: ${domain}`);
                }
            }

            const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.id, subjectId) });
            if (!user) {
                throw privacyError('SUBJECT_NOT_FOUND', 'Privacy subject could not be resolved');
            }

            /** @type {string[]} */
            const dossierStorageKeys = [];
            try {
                const result = await executeWithTransaction(db, async (/** @type {{ delete: (arg0: any) => { (): any; new (): any; where: { (arg0: any): { (): any; new (): any; returning: { (arg0: { id: any; }): any; new (): any; }; }; new (): any; }; }; update: (arg0: any) => { (): any; new (): any; set: { (arg0: { beneficiaryName: string; beneficiaryPhone: null; citizenEmailSnapshot: null; notes: null; citizenUserId: null; }): { (): any; new (): any; where: { (arg0: any): { (): any; new (): any; returning: { (arg0: { id: any; }): any; new (): any; }; }; new (): any; }; }; new (): any; }; }; }} */ tx) => {
                    const records = await collectSubjectRecords(tx, subjectId);
                    const recordIds = affectedRecordIds(subjectId, records, domains);
                    const holds = await findActiveLegalHolds(tx, recordIds);

                    if (holds.length > 0) {
                        throw privacyError('LEGAL_HOLD_ACTIVE', 'Active legal hold blocks erasure');
                    }

                    const summary = {
                        conversationsDeleted: 0,
                        authTokensDeleted: 0,
                        diagnosticsDeleted: 0,
                        appointmentsAnonymized: 0,
                        rdvConversationsDeleted: 0,
                        rdvMessagesDeleted: 0,
                        rdvNotificationsDeleted: 0,
                        operationalConsentsDeleted: 0,
                        guardianRelationshipsDeleted: 0,
                        profileDeleted: 0,
                        retainedDomains: ['ConsentLog', 'DSRRequest', 'LegalHold', 'AuditLog']
                    };

                    if (domains.includes('CitizenSession')) {
                        const conversations = await tx.delete(ConversationLog)
                            .where(eq(ConversationLog.sessionId, subjectId))
                            .returning({ id: ConversationLog.id });
                        summary.conversationsDeleted = conversations.length;

                        const tokens = await tx.delete(AuthToken)
                            .where(eq(AuthToken.userId, subjectId))
                            .returning({ id: AuthToken.id });
                        summary.authTokensDeleted = tokens.length;
                    }

                    if (domains.includes('EligibilitySimulation')) {
                        const diagnostics = await tx.delete(SharedDiagnostic)
                            .where(eq(SharedDiagnostic.privacySubjectId, subjectId))
                            .returning({ id: SharedDiagnostic.id, results: SharedDiagnostic.results });
                        summary.diagnosticsDeleted = diagnostics.length;
                        // DTA S8: remember the object-storage keys of the deleted dossiers; the blobs are erased after the transaction commits (see below).
                        for (const row of diagnostics) dossierStorageKeys.push(...storageKeysOf(row?.results));
                    }

                    if (domains.includes('CitizenAppointment')) {
                        const appointments = await tx.update(ProAppointment)
                            .set({
                                beneficiaryName: '[anonymisé]',
                                beneficiaryPhone: null,
                                citizenEmailSnapshot: null,
                                notes: null,
                                citizenUserId: null
                            })
                            .where(eq(ProAppointment.citizenUserId, subjectId))
                            .returning({ id: ProAppointment.id });
                        summary.appointmentsAnonymized = appointments.length;
                    }

                    if (domains.includes('CitizenMessaging')) {
                        // PKG-4 / R14: message attachments cascade with the conversations; their encrypted blobs are purged after commit (same path as dossier files)
                        const attachmentKeys = typeof tx.select === 'function' ? await tx.select({ k: RdvMessageAttachment.storageKey }).from(RdvMessageAttachment)
                            .innerJoin(RdvConversation, eq(RdvConversation.id, RdvMessageAttachment.conversationId)).where(eq(RdvConversation.citizenUserId, subjectId)) : [];
                        for (const r of attachmentKeys) dossierStorageKeys.push(r.k);
                        summary.messageAttachmentsDeleted = attachmentKeys.length;
                        const rdvConversations = await tx.delete(RdvConversation)
                            .where(eq(RdvConversation.citizenUserId, subjectId))
                            .returning({ id: RdvConversation.id });
                        summary.rdvConversationsDeleted = rdvConversations.length;
                        summary.rdvMessagesDeleted = records.rdvMessages.length;
                        summary.rdvNotificationsDeleted = records.rdvNotifications.length;
                    }

                    if (domains.includes('OperationalConsent')) {
                        const operationalConsents = await tx.delete(UserConsent)
                            .where(eq(UserConsent.citizenId, subjectId))
                            .returning({ id: UserConsent.id });
                        summary.operationalConsentsDeleted = operationalConsents.length;
                    }

                    if (domains.includes('GuardianRelationship')) {
                        const guardianRelationships = await tx.delete(GuardianRelationship)
                            .where(or(
                                eq(GuardianRelationship.minorId, subjectId),
                                eq(GuardianRelationship.guardianId, subjectId)
                            ))
                            .returning({ id: GuardianRelationship.id });
                        summary.guardianRelationshipsDeleted = guardianRelationships.length;
                    }

                    if (domains.includes('CitizenProfile')) {
                        // PKG-2: the Coffre rows cascade with the account; remember their blob keys so the encrypted files are purged after commit (same path as dossier files)
                        const coffreKeys = typeof tx.select === 'function' ? await tx.select({ k: CitizenDocument.storageKey }).from(CitizenDocument).where(eq(CitizenDocument.userId, subjectId)) : [];
                        for (const r of coffreKeys) dossierStorageKeys.push(r.k);
                        summary.coffreDocumentsDeleted = coffreKeys.length;
                        const profiles = await tx.delete(CitizenUser)
                            .where(eq(CitizenUser.id, subjectId))
                            .returning({ id: CitizenUser.id });
                        summary.profileDeleted = profiles.length;
                    }

                    await writeDsrAudit(tx, cryptoLib, {
                        action: 'DSR_DELETE_COMPLETED',
                        subjectId,
                        requestId,
                        status: 'COMPLETED',
                        domains
                    });

                    return summary;
                });
                // Committed: now (and only now) the encrypted documents of the erased dossiers are deleted from object storage. Best effort; failures are logged by key.
                await purgeDossierFiles(dossierStorageKeys).catch(() => { });
                return result;
            } catch (error) {
                if (error?.code === 'LEGAL_HOLD_ACTIVE') {
                    await writeDsrAudit(db, cryptoLib, {
                        action: 'DSR_DELETE_BLOCKED_LEGAL_HOLD',
                        subjectId,
                        requestId,
                        status: 'BLOCKED',
                        domains,
                        reasonCode: 'LEGAL_HOLD_ACTIVE'
                    });
                }
                throw error;
            }
        },

        // @ts-ignore
        async executeApprovedDeletion(requestId) {
            const request = await db.query.DSRRequest.findFirst({ where: eq(DSRRequest.id, requestId) });
            if (!request) {
                throw privacyError('DSR_REQUEST_NOT_FOUND', 'DSR request could not be resolved');
            }
            if (request.requestType !== 'DELETE') {
                throw privacyError('DSR_REQUEST_TYPE_MISMATCH', 'DSR request is not a deletion request');
            }
            if (request.status !== 'APPROVED') {
                throw privacyError('DSR_REQUEST_NOT_APPROVED', 'Deletion requires an approved DSR request');
            }

            const subjectId = request.subjectId;
            const records = await collectSubjectRecords(db, subjectId);
            const holdIds = affectedRecordIds(subjectId, records, ERASABLE_DOMAINS);
            const holds = await findActiveLegalHolds(db, holdIds);

            if (holds.length > 0) {
                await writeDsrAudit(db, cryptoLib, {
                    action: 'DSR_DELETE_BLOCKED_LEGAL_HOLD',
                    subjectId,
                    requestId,
                    status: 'BLOCKED',
                    domains: ERASABLE_DOMAINS,
                    reasonCode: 'LEGAL_HOLD_ACTIVE'
                });
                throw privacyError('LEGAL_HOLD_ACTIVE', 'Active legal hold blocks erasure');
            }

            await this.updateDsrRequestStatus(requestId, 'EXECUTING');

            try {
                const summary = await this.deleteDataDomains(subjectId, ERASABLE_DOMAINS, { requestId });
                await this.updateDsrRequestStatus(requestId, 'COMPLETED');
                return summary;
            } catch (error) {
                if (error?.code !== 'LEGAL_HOLD_ACTIVE') {
                    await this.updateDsrRequestStatus(requestId, 'PARTIALLY_COMPLETED').catch(() => null);
                }
                throw error;
            }
        },

        async dryRunRetention() {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 730);

            const candidates = await db.query.CitizenUser.findMany({
                // @ts-ignore
                where: (/** @type {{ updatedAt: string | number | boolean | null | undefined }} */ users, { lt }) => lt(users.updatedAt, cutoff)
            }).catch(() => []);

            const holds = await safeFindMany(db.query?.LegalHold, {
                where: eq(LegalHold.status, 'ACTIVE')
            });
            const holdIds = new Set(holds.map((hold) => String(hold.recordId)));

            return candidates.filter((/** @type {{ id: string | number | boolean | null | undefined }} */ candidate) => !holdIds.has(String(candidate.id)));
        }
    };
}
