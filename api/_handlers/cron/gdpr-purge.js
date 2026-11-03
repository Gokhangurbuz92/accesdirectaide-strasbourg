// @ts-nocheck
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import {
    EntityVersion, UpdateLog, AuditLog, ConversationLog, SharedDiagnostic,
    AuthToken, AiMetric, ConsentLog, UserConsent, Invitation, EmailChangeRequest,
    ProOutlookToken, ProAuditLog, ProAppointment
} from '../../../src/db/schema.js';
import { lt, and, or, ne, isNotNull, isNull, eq, sql } from 'drizzle-orm';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { purgeDossierFiles, storageKeysOf } from '../../_services/dossier-files.js';
import * as Sentry from '@sentry/node';
import { restrictedDossierSql } from '../../_services/processing-restriction.js';
import { appointmentGuestSchema } from '../../_utils/schema-features.js';
import { GUEST_DECOY_NAME } from '../../_utils/rdv-guest-decoy.js';

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
    GUEST_HOLD_DAYS: 1,             // R38: an unconfirmed account-free hold, 1 day after its expiry
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
 *   - ProAppointment       anonymise after 2 years (730 days) — R38: guest e-mail / phone / hashes included; R39: the guest's reminder consent too
 *   - ProAppointment       R38: an account-free hold never confirmed, cleared 1 day after its expiry; R41-B: a decoy hold (no personal data) deleted then
 *
 * Schedule: every Sunday at 03:00 (vercel.json)
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

/**
 * R40 / G7 — an ACTIVE legal hold protects a record from every automated deletion, not only the shared dossiers. A hold names a record id
 * (privacy-console HOLD_CATEGORIES: SharedDiagnostic, CitizenUser, ProCase, Structure); a row is kept when ANY of the ids it carries (its own id, the person,
 * the organization, the audited entity…) is under an active hold, whatever the hold's category (ids are UUIDs: matching across categories can only keep
 * more, never delete more). Tables with no link to a holdable record (UpdateLog, AiMetric, ConversationLog — a session id only) and expired one-time
 * credentials (AuthToken, EmailChangeRequest, ProOutlookToken: keeping an expired secret proves nothing) are not filtered.
 * @param {...any} ids SQL expressions (columns) of the row
 */
export const heldSql = (...ids) => sql`EXISTS (SELECT 1 FROM "LegalHold" h WHERE h.status = 'ACTIVE' AND h."recordId" IN (${sql.join(ids, sql`, `)}))`;

/**
 * R40 / G7 — EntityVersion and rollback. A version is the exact row snapshotted BEFORE a content change (content-versions.js snapshotRow); a rollback
 * (A07, and the content-transfer rollback of docs/runbooks.md § 7) restores from it. Rule (conservative; the 90-day duration is unchanged): a version older
 * than 90 days is deleted only when it is SUPERSEDED — a newer version of the same record exists — and the record is not under a legal hold. The most
 * recent version of every record is kept however old, so the last change of any record can always be undone.
 * @param {any} database @param {Date} before
 */
export async function purgeSupersededVersions(database, before) {
    const res = await database.delete(EntityVersion).where(and(
        lt(EntityVersion.createdAt, before),
        sql`EXISTS (SELECT 1 FROM "EntityVersion" newer WHERE newer.entity_type = ${EntityVersion.entity_type} AND newer.entity_id = ${EntityVersion.entity_id}
            AND (newer."createdAt", newer.id) > (${EntityVersion.createdAt}, ${EntityVersion.id}))`,
        sql`NOT ${heldSql(EntityVersion.entity_id)}`
    ));
    return Number(res?.rowCount ?? res?.length ?? 0);
}

/**
 * PKG-11 / C22 — consent rows older than `before` are deleted only when SUPERSEDED: a newer decision exists for the same subject and purpose. The latest decision
 * of a subject for a purpose proves what applies now and is never deleted, however old. Returns the number of rows deleted.
 * @param {any} database @param {Date} before
 */
export async function purgeSupersededConsents(database, before) {
    const res = await database.delete(ConsentLog).where(and(
        lt(ConsentLog.created_at, before),
        sql`EXISTS (SELECT 1 FROM "ConsentLog" newer WHERE newer.subject_type = ${ConsentLog.subject_type} AND newer.subject_id = ${ConsentLog.subject_id}
            AND newer.purpose IS NOT DISTINCT FROM ${ConsentLog.purpose} AND newer.created_at > ${ConsentLog.created_at})`,
        sql`NOT ${heldSql(ConsentLog.subject_id)}`   // R40 / G7
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

    // R33: deletions run only when the operator has explicitly enabled them (retention periods approved). Fail-closed: anything else skips.
    if (String(process.env.GDPR_PURGE_ENABLED || '').trim().toLowerCase() !== 'true') {
        return res.status(200).json({ skipped: true, reason: 'GDPR_PURGE_DISABLED', message: 'Purge disabled until GDPR_PURGE_ENABLED=true (retention periods must be approved first). Nothing deleted.' });
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
      // R40 / G7: one purge at a time (two overlapping runs — a manual call during the scheduled one — would double-count and race on the blob deletions).
      // The lock is held by this transaction for the whole run, the steps themselves run on `db` as before (each commits on its own), like referral-timeouts.
      return await db.transaction(async (lockTx) => {
        const [lock] = (await lockTx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('ada:gdpr-purge')) AS ok`)).rows;
        if (!lock?.ok) return res.status(409).json({ skipped: true, reason: 'ALREADY_RUNNING', message: 'Another purge is running. Nothing deleted.' });
        logger.info('🧹 Starting GDPR Purge...');

        // R40 / G10: the account-free booking columns exist only from migration 0043 (0044 for the reminder consent). Read once per run; on an older
        // database the guest parts are left out (no guest data can exist there) and said in skipped_steps
        let guestSchema = { guestBooking: false, guestReminderConsent: false };
        try { guestSchema = await appointmentGuestSchema(db); } catch (stepErr) { recordFailure('schemaDetection', stepErr); }
        const skippedSteps = [];

        // 1. Purge Old Entity Versions (90 days) — R38: steps 1 and 2 get the same per-step handling as the others (a failure here aborted every later step)
        let deletedVersionsCount = 0;
        try {
            // R40 / G7: superseded versions only — the latest version of each record stays (rollback), and none of a record under a legal hold
            deletedVersionsCount = await purgeSupersededVersions(db, daysAgo(RETENTION.ENTITY_VERSION_DAYS));
        } catch (stepErr) { recordFailure('deletedVersionsCount', stepErr); }

        // 2. Purge Old Update Logs (90 days — operational)
        let deletedLogsCount = 0;
        try {
            deletedLogsCount = affected(await db.delete(UpdateLog).where(lt(UpdateLog.ran_at, daysAgo(RETENTION.CONVERSATION_LOG_DAYS))));
        } catch (stepErr) { recordFailure('deletedLogsCount', stepErr); }

        // 3. Purge sensitive AuditLog (365 days — legal obligation)
        let deletedAuditCount = 0;
        try {
            // owner LAB audit: an emergency access (break-glass) still awaiting its review by another administrator is kept until reviewed — the « to review »
            // list is computed from these rows, and an unreviewed use must never drop off it by age
            const auditRes = await db.delete(AuditLog).where(and(lt(AuditLog.timestamp, daysAgo(RETENTION.AUDIT_LOG_DAYS)),
                sql`NOT (${AuditLog.action} = 'BREAK_GLASS_OPENED' AND NOT EXISTS (SELECT 1 FROM "AuditLog" r WHERE r.action = 'BREAK_GLASS_REVIEWED' AND r.entity_id = ${AuditLog.entity_id}))`,
                sql`NOT ${heldSql(AuditLog.entity_id, AuditLog.actor_id, AuditLog.target)}`));   // R40 / G7: the trail of a held record is evidence
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
                    // R40 / G7: nor a dossier whose person is held, nor one followed in a held professional case
                    sql`NOT ${heldSql(SharedDiagnostic.id, SharedDiagnostic.ownerCitizenId, SharedDiagnostic.privacySubjectId)}`,
                    sql`NOT EXISTS (SELECT 1 FROM "LegalHold" h JOIN "ProCase" pc ON pc.id = h."recordId" WHERE h.status = 'ACTIVE' AND pc."sharedDiagnosticId" = ${SharedDiagnostic.id})`,
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
            const ucRes = await db.delete(UserConsent).where(and(lt(UserConsent.expiresAt, now), sql`NOT ${heldSql(UserConsent.citizenId, UserConsent.structureId)}`));   // R40 / G7
            deletedUserConsentsCount = affected(ucRes);
        } catch (stepErr) { recordFailure('deletedUserConsentsCount', stepErr); }

        // 10. Purge Expired Invitations (30-day grace after expiry)
        let deletedInvitationsCount = 0;
        try {
            const invRes = await db.delete(Invitation).where(and(lt(Invitation.expires_at, daysAgo(RETENTION.INVITATION_GRACE_DAYS)), sql`NOT ${heldSql(Invitation.structureId)}`));   // R40 / G7
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
            const palRes = await db.delete(ProAuditLog).where(and(lt(ProAuditLog.createdAt, daysAgo(RETENTION.PRO_AUDIT_LOG_DAYS)),
                sql`NOT ${heldSql(ProAuditLog.entityId, ProAuditLog.proUserId, ProAuditLog.structureId)}`));   // R40 / G7
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
                    // R38: an account-free booking's sealed e-mail / phone, its e-mail blind index and its code / manage-token hashes go too
                    // R40 / G10: only where the columns exist (migration 0043; 0044 for the reminder consent)
                    ...(guestSchema.guestBooking ? {
                        guestEmail: null,
                        guestEmailHash: null,
                        guestPhone: null,
                        guestCodeHash: null,
                        guestManageTokenHash: null,
                    } : {}),
                    ...(guestSchema.guestReminderConsent ? {
                        guestReminderConsentAt: null,   // R39: the optional J-1 reminder consent goes with the rest of the booking's guest data
                    } : {}),
                })
                .where(
                    and(
                        lt(ProAppointment.createdAt, daysAgo(RETENTION.APPOINTMENT_ANON_DAYS)),
                        // R38: « <> » is never true for NULL — an appointment without a beneficiary name kept its phone, e-mail and notes
                        or(isNull(ProAppointment.beneficiaryName), ne(ProAppointment.beneficiaryName, '[anonymisé]')),
                        // R40 / G7: an appointment of a held person or organization (or itself held) keeps its data
                        sql`NOT ${heldSql(ProAppointment.id, ProAppointment.citizenUserId, ProAppointment.structureId)}`
                    )
                );
            anonymisedAppointmentsCount = affected(anonRes);
        } catch (stepErr) { recordFailure('anonymisedAppointmentsCount', stepErr); }

        // 13b. R38: an account-free hold never confirmed is not a booking — one day after its 20-minute expiry its identity is cleared (the row stays,
        // cancelled, so the structure's history and the notice ledger keep their reference)
        let clearedGuestHoldsCount = 0;
        let deletedGuestDecoysCount = 0;
        if (!guestSchema.guestBooking) skippedSteps.push('clearedGuestHoldsCount');   // R40 / G10: before migration 0043 no account-free hold can exist
        else try {
            // R41-B: a decoy hold (the « already booked » answer: no personal data, never confirmable) is deleted at the same moment a real hold is cleared —
            // after that, confirm answers both exactly like an id that never existed; nothing of it is kept (no history, no statistic)
            const decoyRes = await db.delete(ProAppointment)
                .where(and(eq(ProAppointment.beneficiaryName, GUEST_DECOY_NAME), isNotNull(ProAppointment.guestHoldExpiresAt),
                    lt(ProAppointment.guestHoldExpiresAt, daysAgo(RETENTION.GUEST_HOLD_DAYS)), sql`NOT ${heldSql(ProAppointment.id, ProAppointment.structureId)}`));
            deletedGuestDecoysCount = affected(decoyRes);
            const holdRes = await db.update(ProAppointment)
                .set({ status: 'cancelled', cancelledAt: now, cancelledBy: 'GUEST_HOLD_EXPIRED', beneficiaryName: '[anonymisé]', beneficiaryPhone: null, notes: null,
                    guestEmail: null, guestEmailHash: null, guestPhone: null, guestCodeHash: null, guestManageTokenHash: null,
                    ...(guestSchema.guestReminderConsent ? { guestReminderConsentAt: null } : {}) })
                .where(and(isNotNull(ProAppointment.guestHoldExpiresAt), lt(ProAppointment.guestHoldExpiresAt, daysAgo(RETENTION.GUEST_HOLD_DAYS)),
                    or(isNotNull(ProAppointment.guestEmail), ne(ProAppointment.beneficiaryName, '[anonymisé]')), ne(ProAppointment.beneficiaryName, GUEST_DECOY_NAME),
                    sql`NOT ${heldSql(ProAppointment.id, ProAppointment.structureId)}`));   // R40 / G7
            clearedGuestHoldsCount = affected(holdRes);
        } catch (stepErr) { recordFailure('clearedGuestHoldsCount', stepErr); }

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
            guest_holds_cleared: clearedGuestHoldsCount,
            guest_decoy_holds_deleted: deletedGuestDecoysCount,
            status: failedSteps.length === 0 ? 'success' : 'partial_failure',
            ...(failedSteps.length ? { failed_steps: failedSteps } : {}),
            ...(skippedSteps.length ? { skipped_steps: skippedSteps } : {}),
        };
        // launch-readiness item 62: what no job deletes yet, counted (never deleted here: a duration becomes a deletion only by an owner / DPO decision)
        const retention = await import('../../_services/retention.js').then((m) => m.retentionReport()).catch(() => null);
        summary.retention_report = retention ? retention.items.map(({ key, durationDays, total, overdue }) => ({ key, durationDays, total, overdue })) : null;

        logger.info('✅ GDPR Purge complete:', summary);
        return res.status(failedSteps.length === 0 ? 200 : 500).json(summary);
      });
    } catch (e) {
        logger.error('GDPR Purge Failed:', e);
        Sentry.captureException(e);
        return res.status(500).json({ error: 'GDPR_PURGE_FAILED' });   // R38: the raw error stays in the logs and Sentry, not in the response
    }
}
