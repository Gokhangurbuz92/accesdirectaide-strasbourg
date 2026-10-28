// @ts-nocheck
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import {
    EntityVersion, UpdateLog, AuditLog, ConversationLog, SharedDiagnostic,
    AuthToken, AiMetric, ConsentLog, UserConsent, Invitation, EmailChangeRequest,
    ProOutlookToken, ProAuditLog, ProAppointment
} from '../../../src/db/schema.js';
import { lt, and, or, ne, isNotNull, eq, sql } from 'drizzle-orm';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { purgeDossierFiles, storageKeysOf } from '../../_services/dossier-files.js';
import * as Sentry from '@sentry/node';
import { restrictedDossierSql } from '../../_services/processing-restriction.js';

/**
 * Per-table RGPD retention constants.
 * Exported so tests can validate against documentation.
 */
export const RETENTION = {
    AUDIT_LOG_DAYS: 365,            // Legal obligation (Art 6.1.c)
    PRO_AUDIT_LOG_DAYS: 365,        // Same as AuditLog
    CONVERSATION_LOG_DAYS: 90,      // Operational
    AI_METRIC_DAYS: 90,             // Technical hygiene
    ENTITY_VERSION_DAYS: 90,        // Historical snapshots
    CONSENT_LOG_DAYS: 1095,         // 3 years (legal proof)
    INVITATION_GRACE_DAYS: 30,      // After expiry
    OUTLOOK_TOKEN_GRACE_DAYS: 30,   // After expiry
    APPOINTMENT_ANON_DAYS: 730,     // 2 years then anonymise
};

/**
 * GDPR Purge Cron
 *
 * Automatically purges expired/old data to comply with RGPD:
 *   - EntityVersion        > 90 days
 *   - UpdateLog            > 90 days
 *   - AuditLog             > 365 days (legal obligation)
 *   - ConversationLog      > 90 days
 *   - SharedDiagnostic     expired or > 90 days
 *   - AuthToken            where expiresAt < NOW() (and the expired EmailChangeRequest rows)
 *   - AiMetric             > 90 days
 *   - ConsentLog           > 3 years (1095 days)
 *   - UserConsent          where expiresAt < NOW()
 *   - Invitation           expired + 30 day grace
 *   - ProOutlookToken      expired + 30 day grace
 *   - ProAuditLog          > 365 days
 *   - ProAppointment       anonymise after 2 years (730 days)
 *
 * Schedule: every Sunday at 03:00 (vercel.json)
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

/**
 * PKG-11 / C22 — consent rows older than `before` are deleted only when SUPERSEDED: a newer decision exists for the same subject and purpose. The latest decision
 * of a subject for a purpose proves what applies now and is never deleted, however old. Returns the number of rows deleted.
 * @param {any} database @param {Date} before
 */
export async function purgeSupersededConsents(database, before) {
    const res = await database.delete(ConsentLog).where(and(
        lt(ConsentLog.created_at, before),
        sql`EXISTS (SELECT 1 FROM "ConsentLog" newer WHERE newer.subject_type = ${ConsentLog.subject_type} AND newer.subject_id = ${ConsentLog.subject_id}
            AND newer.purpose IS NOT DISTINCT FROM ${ConsentLog.purpose} AND newer.created_at > ${ConsentLog.created_at})`
    ));
    return Number(res?.rowCount ?? res?.length ?? 0);
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const secret = req.query?.secret ?? req.query?.key;
    const authReq = { headers: req.headers, query: { secret }, url: req.url };
    const auth = getCronAuth(authReq);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') {
            return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }

    /** Helper: compute a cutoff date N days in the past */
    const daysAgo = (/** @type {number} */ days) => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d;
    };

    const now = new Date();

    /** Rows affected by a drizzle delete/update: node-postgres returns a result object (rowCount), not an array. */
    const affected = (/** @type {any} */ r) => Number(r?.rowCount ?? r?.length ?? 0);
    /** Retention steps must never fail silently: each failure is logged, reported to Sentry and returned in the summary. */
    const failedSteps = [];
    const recordFailure = (/** @type {string} */ step, /** @type {any} */ err) => {
        failedSteps.push(step);
        logger.error({ err, step }, '[gdpr-purge] retention step failed');
        Sentry.captureException(err);
    };

    try {
        logger.info('🧹 Starting GDPR Purge...');

        // 1. Purge Old Entity Versions (90 days)
        const deletedVersions = await db.delete(EntityVersion).where(lt(EntityVersion.createdAt, daysAgo(RETENTION.ENTITY_VERSION_DAYS)));
        const deletedVersionsCount = affected(deletedVersions);

        // 2. Purge Old Update Logs (90 days — operational)
        const deletedLogs = await db.delete(UpdateLog).where(lt(UpdateLog.ran_at, daysAgo(RETENTION.CONVERSATION_LOG_DAYS)));
        const deletedLogsCount = affected(deletedLogs);

        // 3. Purge sensitive AuditLog (365 days — legal obligation)
        let deletedAuditCount = 0;
        try {
            // owner LAB audit: an emergency access (break-glass) still awaiting its review by another administrator is kept until reviewed — the « to review »
            // list is computed from these rows, and an unreviewed use must never drop off it by age
            const auditRes = await db.delete(AuditLog).where(and(lt(AuditLog.timestamp, daysAgo(RETENTION.AUDIT_LOG_DAYS)),
                sql`NOT (${AuditLog.action} = 'BREAK_GLASS_OPENED' AND NOT EXISTS (SELECT 1 FROM "AuditLog" r WHERE r.action = 'BREAK_GLASS_REVIEWED' AND r.entity_id = ${AuditLog.entity_id}))`));
            deletedAuditCount = affected(auditRes);
        } catch (stepErr) { recordFailure('deletedAuditCount', stepErr); }

        // 4. Purge Old Conversation Logs (90 days — RGPD citizen data)
        let deletedConversationsCount = 0;
        try {
            const convRes = await db.delete(ConversationLog).where(lt(ConversationLog.createdAt, daysAgo(RETENTION.CONVERSATION_LOG_DAYS)));
            deletedConversationsCount = affected(convRes);
        } catch (stepErr) { recordFailure('deletedConversationsCount', stepErr); }

        // 5. Purge Old/Expired Shared Diagnostics (expired OR > 90 days)
        let deletedDiagnosticsCount = 0;
        try {
            const diagRes = await db.delete(SharedDiagnostic).where(
                and(
                    or(
                        and(isNotNull(SharedDiagnostic.expiresAt), lt(SharedDiagnostic.expiresAt, now)),
                        lt(SharedDiagnostic.createdAt, daysAgo(RETENTION.ENTITY_VERSION_DAYS))
                    ),
                    // PKG-5 / A12: a dossier under an ACTIVE legal hold is never purged automatically
                    sql`NOT EXISTS (SELECT 1 FROM "LegalHold" h WHERE h.status = 'ACTIVE' AND h."dataCategory" = 'SharedDiagnostic' AND h."recordId" = ${SharedDiagnostic.id})`,
                    // PKG-11 / C21: a dossier whose owner restricted processing (art. 18) is kept, not deleted automatically (storage only)
                    sql`NOT ${restrictedDossierSql(SharedDiagnostic.id)}`
                )
            ).returning({ id: SharedDiagnostic.id, results: SharedDiagnostic.results });
            deletedDiagnosticsCount = affected(diagRes);
            // DTA S8: the encrypted documents of a purged dossier are deleted from object storage too (best effort; a blob that cannot be deleted is logged by key).
            const purgedFiles = await purgeDossierFiles((Array.isArray(diagRes) ? diagRes : []).flatMap((row) => storageKeysOf(row?.results)));
            if (purgedFiles.failed.length > 0) failedSteps.push('dossierFilesPurge');
        } catch (stepErr) { recordFailure('deletedDiagnosticsCount', stepErr); }

        // 6. Purge Expired Auth Tokens
        let deletedTokensCount = 0;
        try {
            const tokenRes = await db.delete(AuthToken).where(lt(AuthToken.expiresAt, now));
            deletedTokensCount = affected(tokenRes);
        } catch (stepErr) { recordFailure('deletedTokensCount', stepErr); }

        // 6b. launch-readiness item 66: expired e-mail change requests (an encrypted pending address, single-use link)
        let deletedEmailChangeCount = 0;
        try {
            deletedEmailChangeCount = affected(await db.delete(EmailChangeRequest).where(lt(EmailChangeRequest.expiresAt, now)));
        } catch (stepErr) { recordFailure('deletedEmailChangeCount', stepErr); }

        // 7. Purge Old AI Metrics (90 days — non-personal, storage hygiene)
        let deletedAiMetricsCount = 0;
        try {
            const aiRes = await db.delete(AiMetric).where(lt(AiMetric.createdAt, daysAgo(RETENTION.AI_METRIC_DAYS)));
            deletedAiMetricsCount = affected(aiRes);
        } catch (stepErr) { recordFailure('deletedAiMetricsCount', stepErr); }

        // 8. Purge Old Consent Logs (1095 days / 3 years — legal proof). PKG-11 / C22: only SUPERSEDED rows — the latest decision of a subject for a purpose
        //    proves what applies now and is never deleted, however old (before: every row older than 3 years, current consents included).
        let deletedConsentLogsCount = 0;
        try {
            deletedConsentLogsCount = await purgeSupersededConsents(db, daysAgo(RETENTION.CONSENT_LOG_DAYS));
        } catch (stepErr) { recordFailure('deletedConsentLogsCount', stepErr); }

        // 9. Purge Expired User Consents
        let deletedUserConsentsCount = 0;
        try {
            const ucRes = await db.delete(UserConsent).where(lt(UserConsent.expiresAt, now));
            deletedUserConsentsCount = affected(ucRes);
        } catch (stepErr) { recordFailure('deletedUserConsentsCount', stepErr); }

        // 10. Purge Expired Invitations (30-day grace after expiry)
        let deletedInvitationsCount = 0;
        try {
            const invRes = await db.delete(Invitation).where(lt(Invitation.expires_at, daysAgo(RETENTION.INVITATION_GRACE_DAYS)));
            deletedInvitationsCount = affected(invRes);
        } catch (stepErr) { recordFailure('deletedInvitationsCount', stepErr); }

        // 11. Purge Expired ProOutlookTokens (30-day grace after expiry)
        let deletedOutlookTokensCount = 0;
        try {
            const otRes = await db.delete(ProOutlookToken).where(lt(ProOutlookToken.expiresAt, daysAgo(RETENTION.OUTLOOK_TOKEN_GRACE_DAYS)));
            deletedOutlookTokensCount = affected(otRes);
        } catch (stepErr) { recordFailure('deletedOutlookTokensCount', stepErr); }

        // 12. Purge Old Pro Audit Logs (365 days — legal obligation)
        let deletedProAuditCount = 0;
        try {
            const palRes = await db.delete(ProAuditLog).where(lt(ProAuditLog.createdAt, daysAgo(RETENTION.PRO_AUDIT_LOG_DAYS)));
            deletedProAuditCount = affected(palRes);
        } catch (stepErr) { recordFailure('deletedProAuditCount', stepErr); }

        // 13. Anonymise Old ProAppointments (730 days / 2 years)
        let anonymisedAppointmentsCount = 0;
        try {
            const anonRes = await db.update(ProAppointment)
                .set({
                    beneficiaryName: '[anonymisé]',
                    beneficiaryPhone: null,
                    citizenEmailSnapshot: null,
                    notes: null,
                })
                .where(
                    and(
                        lt(ProAppointment.createdAt, daysAgo(RETENTION.APPOINTMENT_ANON_DAYS)),
                        ne(ProAppointment.beneficiaryName, '[anonymisé]')
                    )
                );
            anonymisedAppointmentsCount = affected(anonRes);
        } catch (stepErr) { recordFailure('anonymisedAppointmentsCount', stepErr); }

        const summary = {
            versions_deleted: deletedVersionsCount,
            update_logs_deleted: deletedLogsCount,
            audit_logs_deleted: deletedAuditCount,
            conversation_logs_deleted: deletedConversationsCount,
            diagnostics_deleted: deletedDiagnosticsCount,
            tokens_deleted: deletedTokensCount,
            email_change_requests_deleted: deletedEmailChangeCount,
            ai_metrics_deleted: deletedAiMetricsCount,
            consent_logs_deleted: deletedConsentLogsCount,
            user_consents_deleted: deletedUserConsentsCount,
            invitations_deleted: deletedInvitationsCount,
            outlook_tokens_deleted: deletedOutlookTokensCount,
            pro_audit_logs_deleted: deletedProAuditCount,
            appointments_anonymised: anonymisedAppointmentsCount,
            status: failedSteps.length === 0 ? 'success' : 'partial_failure',
            ...(failedSteps.length ? { failed_steps: failedSteps } : {}),
        };
        // launch-readiness item 62: what no job deletes yet, counted (never deleted here: a duration becomes a deletion only by an owner / DPO decision)
        const retention = await import('../../_services/retention.js').then((m) => m.retentionReport()).catch(() => null);
        summary.retention_report = retention ? retention.items.map(({ key, durationDays, total, overdue }) => ({ key, durationDays, total, overdue })) : null;

        logger.info('✅ GDPR Purge complete:', summary);
        return res.status(failedSteps.length === 0 ? 200 : 500).json(summary);
    } catch (e) {
        logger.error('GDPR Purge Failed:', e);
        Sentry.captureException(e);
        return res.status(500).json({ error: e.message });
    }
}
