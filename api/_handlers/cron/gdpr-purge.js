// @ts-nocheck
import defaultLogger from '../../_utils/logger.js';
import { db as defaultDb } from '../../../src/db/index.js';
import {
    EntityVersion, UpdateLog, AuditLog, ConversationLog, SharedDiagnostic,
    AuthToken, AiMetric, ConsentLog, UserConsent, Invitation, EmailChangeRequest,
    ProOutlookToken, ProAuditLog, ProAppointment,
    AppointmentNotice, ProNotification, PushSubscription, RdvConversation, RdvMessageAttachment,
    LegalHold, SupportRequest, DSRRequest, CitizenUser, ProUser
} from '../../../src/db/schema.js';
import { lt, and, or, ne, isNotNull, isNull, eq, sql, inArray } from 'drizzle-orm';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { purgeDossierFiles, storageKeysOf } from '../../_services/dossier-files.js';
import * as Sentry from '@sentry/node';
import { restrictedDossierSql, restrictedSubjectSql } from '../../_services/processing-restriction.js';
import { appointmentGuestSchema } from '../../_utils/schema-features.js';
import { GUEST_DECOY_NAME } from '../../_utils/rdv-guest-decoy.js';
import { RETENTION_POLICY, executionGate, ownerChoiceOf, policyDays, policySummary, stepApprovalProblem } from '../../_services/retention-policy.js';

/**
 * Per-table RGPD retention constants (read by scripts/gdpr-suite.mjs for REGISTRE_RGPD.json, and by tests).
 * R44: the purge itself takes its durations from the VERSIONED policy (api/_services/retention-policy.js, status PROPOSED — NOT APPROVED); these values are
 * the same numbers (a unit test keeps them equal). R44 / E13: no value here is a legal obligation — none was identified (R43 dossier § 3).
 */
export const RETENTION = {
    AUDIT_LOG_DAYS: 365,            // CNIL recommendation 2021-122 (logging: 6 months to 1 year) — not a legal obligation (E13)
    PRO_AUDIT_LOG_DAYS: 365,        // Same as AuditLog (CNIL recommendation 2021-122)
    CONVERSATION_LOG_DAYS: 90,      // Operational
    AI_METRIC_DAYS: 90,             // Technical hygiene
    ENTITY_VERSION_DAYS: 90,        // Historical snapshots
    CONSENT_LOG_DAYS: 1095,         // 3 years — proof that consent can be demonstrated (art. 7(1) fixes no duration): proposal
    INVITATION_GRACE_DAYS: 30,      // After expiry
    OUTLOOK_TOKEN_GRACE_DAYS: 30,   // After expiry
    APPOINTMENT_ANON_DAYS: 730,     // R45: the UPPER option of owner choice A7 (365 or 730 days after startAt), shown by the register until the controller chooses; the purge never reads it (policy: no default)
    GUEST_HOLD_DAYS: 1,             // R38: an unconfirmed account-free hold, 1 day after its expiry
};

/**
 * GDPR Purge Cron — R44: policy-driven, step by step, dry run by default.
 *
 * Every step below has an id, the policy duration it applies, the date it counts from, its gap code (R43 dossier § 3.3) and its kind (delete, anonymise,
 * redact, or report — a report step never changes anything). A run is a DRY RUN (it counts the rows each step would touch, changes nothing, writes nothing)
 * unless executionGate() allows execution (GDPR_PURGE_ENABLED, the policy APPROVED for this exact version, the version pinned by the deployment); even then
 * only the steps listed in GDPR_PURGE_APPROVED_STEPS execute (E16), each in its own transaction (a failing step is rolled back, reported, retried next run).
 * Safeguards on every step that can touch a person's or an organization's data: an ACTIVE LegalHold on any id the row carries; a processing restriction
 * (art. 18) or an open access / review request (DSR) of the person; records of the structure the platform must not erase alone (shared-controller flag, E11).
 * Missing tables or columns (Production is at migration 0042) skip the step, said in skipped_steps. One run at a time (advisory lock). An executing run
 * leaves one AuditLog row (GDPR_PURGE_RUN: counts only) as evidence.
 *
 * Schedule: every Sunday at 03:00 (vercel.json)
 */

/**
 * R40 / G7 — an ACTIVE legal hold protects a record from every automated deletion, not only the shared dossiers. A hold names a record id
 * (privacy-console HOLD_CATEGORIES: SharedDiagnostic, CitizenUser, ProCase, Structure); a row is kept when ANY of the ids it carries (its own id, the person,
 * the organization, the audited entity…) is under an active hold, whatever the hold's category (ids are UUIDs: matching across categories can only keep
 * more, never delete more). Tables with no link to a holdable record (UpdateLog, AiMetric, ConversationLog — a session id only) and expired one-time
 * credentials (AuthToken, EmailChangeRequest, ProOutlookToken: keeping an expired secret proves nothing) are not filtered.
 * @param {...any} ids SQL expressions (columns) of the row
 */
/** an e-mail suppression row (« mail.suppressed ») not followed by a lift of the same HMAC — the suppression still applies @param {any} t */
export const activeSuppressionSql = (t) => sql`(${t.action} = 'mail.suppressed' AND NOT EXISTS (SELECT 1 FROM "AuditLog" l WHERE l.action = 'mail.suppression_lifted'
    AND l.entity_id = ${t.entity_id} AND l.timestamp > ${t.timestamp}))`;
export const heldSql = (...ids) => sql`EXISTS (SELECT 1 FROM "LegalHold" h WHERE h.status = 'ACTIVE' AND h."recordId" IN (${sql.join(ids, sql`, `)}))`;

/** R44 — DSR interplay: an access / review request of the person still open keeps their data until it is answered (an erasure request does not: it goes the same way). */
export const OPEN_DSR_STATUSES = Object.freeze(['RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW']);
export const openNonErasureDsrSql = (subjectExpr) => sql`EXISTS (SELECT 1 FROM "DSRRequest" r WHERE r."subjectId" = ${subjectExpr} AND r."requestType" <> 'DELETE'
    AND r.status IN (${sql.join(OPEN_DSR_STATUSES.map((s) => sql`${s}`), sql`, `)}))`;
/** the person (a citizen id expression, possibly NULL) is protected: restricted processing (art. 18) or an open access / review request */
export const personProtectedSql = (subjectExpr) => sql`(${restrictedSubjectSql(subjectExpr)} OR ${openNonErasureDsrSql(subjectExpr)})`;

/**
 * R44 / E11 — a shared copy followed by an organization (a ProCase or a Referral references it: both CASCADE on its deletion). R45 / ENG-LR-9: also a
 * SharedDossierThread — the exchange a structure's professional opened on the copy (its SharedDossierMessage rows CASCADE with it): deleting the copy erased
 * the structure's correspondence without any basis; such a copy is now redacted (5b), never deleted with its thread.
 */
export const hasFollowUpSql = (dossierExpr) => sql`(EXISTS (SELECT 1 FROM "ProCase" pc WHERE pc."sharedDiagnosticId" = ${dossierExpr})
    OR EXISTS (SELECT 1 FROM "Referral" rf WHERE rf."sharedDiagnosticId" = ${dossierExpr})
    OR EXISTS (SELECT 1 FROM "SharedDossierThread" st WHERE st."sharedDiagnosticId" = ${dossierExpr}))`;

/**
 * R40 / G7 — EntityVersion and rollback. A version is the exact row snapshotted BEFORE a content change (content-versions.js snapshotRow); a rollback
 * (A07, and the content-transfer rollback of docs/runbooks.md § 7) restores from it. Rule (conservative; the 90-day duration is unchanged): a version older
 * than 90 days is deleted only when it is SUPERSEDED — a newer version of the same record exists — and the record is not under a legal hold. The most
 * recent version of every record is kept however old, so the last change of any record can always be undone.
 * @param {Date} before
 */
export const supersededVersionsWhere = (before) => and(
    lt(EntityVersion.createdAt, before),
    sql`EXISTS (SELECT 1 FROM "EntityVersion" newer WHERE newer.entity_type = ${EntityVersion.entity_type} AND newer.entity_id = ${EntityVersion.entity_id}
        AND (newer."createdAt", newer.id) > (${EntityVersion.createdAt}, ${EntityVersion.id}))`,
    sql`NOT ${heldSql(EntityVersion.entity_id)}`
);
/** @param {any} database @param {Date} before */
export async function purgeSupersededVersions(database, before) {
    const res = await database.delete(EntityVersion).where(supersededVersionsWhere(before));
    return Number(res?.rowCount ?? res?.length ?? 0);
}

/**
 * PKG-11 / C22 — consent rows older than `before` are deleted only when SUPERSEDED: a newer decision exists for the same subject and purpose. The latest decision
 * of a subject for a purpose proves what applies now and is never deleted by this rule, however old (R44 / E10: see consentLogsAfterErasureDeleted).
 * @param {Date} before
 */
export const supersededConsentsWhere = (before) => and(
    lt(ConsentLog.created_at, before),
    sql`EXISTS (SELECT 1 FROM "ConsentLog" newer WHERE newer.subject_type = ${ConsentLog.subject_type} AND newer.subject_id = ${ConsentLog.subject_id}
        AND newer.purpose IS NOT DISTINCT FROM ${ConsentLog.purpose} AND newer.created_at > ${ConsentLog.created_at})`,
    sql`NOT ${heldSql(ConsentLog.subject_id)}`   // R40 / G7
);
/** Returns the number of rows deleted. @param {any} database @param {Date} before */
export async function purgeSupersededConsents(database, before) {
    const res = await database.delete(ConsentLog).where(supersededConsentsWhere(before));
    return Number(res?.rowCount ?? res?.length ?? 0);
}

/** Rows affected by a drizzle delete/update: node-postgres returns a result object (rowCount), not an array. */
const affected = (/** @type {any} */ r) => Number(r?.rowCount ?? r?.length ?? 0);
const countWhere = async (db, table, where) => Number((await db.select({ n: sql`count(*)::int` }).from(table).where(where))?.[0]?.n ?? 0);
const ANON = '[anonymisé]';

// ─── appointment predicates (R44 / E1–E5) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** a booking made by a person on the platform (an account, or an account-free guest on a 0043+ LAB database) — as opposed to a record a structure keeps */
const citizenSide = (ctx) => (ctx.guestSchema.guestBooking
    ? sql`(${ProAppointment.citizenUserId} IS NOT NULL OR ${ProAppointment.guestEmailHash} IS NOT NULL)`
    : sql`${ProAppointment.citizenUserId} IS NOT NULL`);
/** some personal data is still on the row (R38: « <> » is never true for NULL; R44 / E2: a row anonymised before R44 still linked to the account counts) */
const notAnonymised = (ctx) => sql`(${ProAppointment.beneficiaryName} IS DISTINCT FROM ${ANON} OR ${ProAppointment.citizenUserId} IS NOT NULL
    OR ${ProAppointment.beneficiaryPhone} IS NOT NULL OR ${ProAppointment.citizenEmailSnapshot} IS NOT NULL OR ${ProAppointment.notes} IS NOT NULL
    ${ctx.guestSchema.guestBooking ? sql`OR ${ProAppointment.guestEmail} IS NOT NULL OR ${ProAppointment.guestPhone} IS NOT NULL OR ${ProAppointment.guestEmailHash} IS NOT NULL` : sql``})`;
/** legal hold (the appointment, the person, the organization), restriction / open request of the person; a decoy hold is never an appointment (13b deletes it) */
const appointmentSafe = () => and(
    sql`NOT ${heldSql(ProAppointment.id, ProAppointment.citizenUserId, ProAppointment.structureId)}`,
    sql`NOT ${personProtectedSql(ProAppointment.citizenUserId)}`,
    sql`${ProAppointment.beneficiaryName} IS DISTINCT FROM ${GUEST_DECOY_NAME}`
);
const UNCONFIRMED = ['refused', 'expired'];
/** E4: a Mode B request still `requested` after its start is an expired request (R42-BOOK § 2) */
const unconfirmedSql = (now) => or(inArray(ProAppointment.status, UNCONFIRMED), and(eq(ProAppointment.status, 'requested'), lt(ProAppointment.startAt, now)));
const otherStatusSql = () => sql`${ProAppointment.status} NOT IN ('refused', 'expired', 'requested', 'cancelled')`;
/** E5: the message counts from the appointment, or from its cancellation when that came first */
const messageAnchor = sql`CASE WHEN ${ProAppointment.cancelledAt} IS NOT NULL THEN LEAST(${ProAppointment.startAt}, ${ProAppointment.cancelledAt}) ELSE ${ProAppointment.startAt} END`;
/** the appointment of this id is anonymised (R44: its notices and its conversation follow) */
const appointmentAnonymisedSql = (idExpr) => sql`EXISTS (SELECT 1 FROM "ProAppointment" a WHERE a.id = ${idExpr} AND a."beneficiaryName" = ${ANON}
    AND a."citizenUserId" IS NULL AND a."beneficiaryPhone" IS NULL AND a."citizenEmailSnapshot" IS NULL AND a.notes IS NULL)`;

/**
 * @typedef {{ now: Date, policy: any, guestSchema: { guestBooking: boolean, guestReminderConsent: boolean }, cutoff: (key: string) => Date }} PurgeContext
 * @typedef {{ id: string, summaryKey: string, ecode: string | null, kind: 'delete' | 'anonymise' | 'redact' | 'report', table: string, durationKey: string,
 *   tables: string[], requiresGuest?: boolean, extraKeys?: string[], dependsOn?: string[], sharedController?: string, count: (db: any, ctx: PurgeContext) => Promise<number>,
 *   run?: (db: any, ctx: PurgeContext) => Promise<number | { count: number, extra?: Record<string, number>, afterCommit?: () => Promise<string | null> }> }} PurgeStep
 */

// 13. Anonymise ProAppointments — the set every anonymising appointment step applies (13 / 13a / 13c / 13d / 13e builds below).
/** @param {PurgeContext} ctx */
export function anonymisationSet(ctx) {
    return {
        beneficiaryName: ANON,
        beneficiaryPhone: null,
        citizenEmailSnapshot: null,
        notes: null,
        citizenUserId: null,   // R44 / E2: the link to the account goes too (otherwise the appointment stays attached to the person: pseudonymisation only)
        // R44 / E4: a request still `requested` after its start is written as the expired request it is
        status: sql`CASE WHEN ${ProAppointment.status} = 'requested' AND ${ProAppointment.startAt} < ${ctx.now} THEN 'expired' ELSE ${ProAppointment.status} END`,
        ...(ctx.guestSchema.guestBooking ? {
            guestEmail: null,
            guestEmailHash: null,
            guestPhone: null,
            guestCodeHash: null,
            guestManageTokenHash: null,
        } : {}),
        ...(ctx.guestSchema.guestReminderConsent ? {
            guestReminderConsentAt: null,   // R39: the optional J-1 reminder consent goes with the rest of the booking's guest data
        } : {}),
    };
}

/** @returns {PurgeStep[]} */
function appointmentSteps() {
    /** @param {(ctx: PurgeContext) => any} where */
    const anonymise = (where) => ({
        count: (db, ctx) => countWhere(db, ProAppointment, where(ctx)),
        run: async (db, ctx) => affected(await db.update(ProAppointment).set(anonymisationSet(ctx)).where(where(ctx))),
    });
    return [
        // 13e. R44 / E5 — the optional message of a citizen booking: 30 days after the appointment (or its earlier cancellation). The safe discriminant is the
        //      account link (citizenUserId IS NOT NULL): `notes` also holds the notes of an appointment a professional created (Q-BOOK-2), never touched here.
        { id: 'appointmentMessagesErased', summaryKey: 'appointment_messages_erased', ecode: 'E5', kind: 'anonymise', table: 'ProAppointment', durationKey: 'APPOINTMENT_MESSAGE_DAYS',
            tables: ['ProAppointment', 'LegalHold', 'DSRRequest'],
            count: (db, ctx) => countWhere(db, ProAppointment, messageWhere(ctx)),
            run: async (db, ctx) => affected(await db.update(ProAppointment).set({ notes: null }).where(messageWhere(ctx))) },
        // 13a. R44 / E3 + E4 — unconfirmed requests (refused, expired, or still `requested` after their start): 3 months after the slot
        { id: 'appointmentsUnconfirmedAnonymised', summaryKey: 'unconfirmed_appointments_anonymised', ecode: 'E3', kind: 'anonymise', table: 'ProAppointment', durationKey: 'APPOINTMENT_UNCONFIRMED_DAYS',
            tables: ['ProAppointment', 'LegalHold', 'DSRRequest'],
            ...anonymise((ctx) => and(citizenSide(ctx), unconfirmedSql(ctx.now), lt(ProAppointment.startAt, ctx.cutoff('APPOINTMENT_UNCONFIRMED_DAYS')), notAnonymised(ctx), appointmentSafe())) },
        // 13c. R44 / E3 — cancelled bookings: 3 months after the cancellation
        { id: 'appointmentsCancelledAnonymised', summaryKey: 'cancelled_appointments_anonymised', ecode: 'E3', kind: 'anonymise', table: 'ProAppointment', durationKey: 'APPOINTMENT_CANCELLED_DAYS',
            tables: ['ProAppointment', 'LegalHold', 'DSRRequest'],
            ...anonymise((ctx) => and(citizenSide(ctx), eq(ProAppointment.status, 'cancelled'),
                sql`COALESCE(${ProAppointment.cancelledAt}, ${ProAppointment.startAt}) < ${ctx.cutoff('APPOINTMENT_CANCELLED_DAYS')}`, notAnonymised(ctx), appointmentSafe())) },
        // 13. R44 / E1 + E2 — confirmed, booked, attended or missed bookings (and any other status): 2 years after the appointment DATE (was: after createdAt)
        { id: 'anonymisedAppointmentsCount', summaryKey: 'appointments_anonymised', ecode: 'E1', kind: 'anonymise', table: 'ProAppointment', durationKey: 'APPOINTMENT_CONFIRMED_DAYS',
            tables: ['ProAppointment', 'LegalHold', 'DSRRequest'],
            ...anonymise((ctx) => and(citizenSide(ctx), otherStatusSql(), lt(ProAppointment.startAt, ctx.cutoff('APPOINTMENT_CONFIRMED_DAYS')), notAnonymised(ctx), appointmentSafe())) },
        // 13d. R44 — an appointment a STRUCTURE recorded without a platform account (citizenUserId NULL, no guest): it is the structure's record; same 2 years
        //      after its date, but a separate step so the controller and the structure can approve (or refuse) it on its own (shared-controller flag)
        { id: 'appointmentsStructureRecordAnonymised', summaryKey: 'structure_appointments_anonymised', ecode: 'E1', kind: 'anonymise', table: 'ProAppointment', durationKey: 'APPOINTMENT_CONFIRMED_DAYS',
            tables: ['ProAppointment', 'LegalHold', 'DSRRequest'], sharedController: 'appointment recorded by the structure (no platform account)',
            ...anonymise((ctx) => and(sql`NOT ${citizenSide(ctx)}`, lt(ProAppointment.startAt, ctx.cutoff('APPOINTMENT_CONFIRMED_DAYS')), notAnonymised(ctx), appointmentSafe())) },
    ];
}

/** @param {PurgeContext} ctx */
function messageWhere(ctx) {
    return and(isNotNull(ProAppointment.notes), isNotNull(ProAppointment.citizenUserId), sql`${messageAnchor} < ${ctx.cutoff('APPOINTMENT_MESSAGE_DAYS')}`, appointmentSafe());
}

/** @param {any} table @param {(ctx: PurgeContext) => any} where */
const deleteStep = (table, where) => ({
    count: (db, ctx) => countWhere(db, table, where(ctx)),
    run: async (db, ctx) => affected(await db.delete(table).where(where(ctx))),
});

// The steps, in dependency order (an appointment is anonymised before its notices and its conversation go; consents of an erased person go before the
// erasure request that proves the erasure).
/** @type {PurgeStep[]} */
export const PURGE_STEPS = [
    // 1. Old Entity Versions (90 days) — R40 / G7: superseded versions only — the latest version of each record stays (rollback), none of a held record
    { id: 'deletedVersionsCount', summaryKey: 'versions_deleted', ecode: null, kind: 'delete', table: 'EntityVersion', durationKey: 'ENTITY_VERSION_DAYS', tables: ['EntityVersion', 'LegalHold'],
        count: (db, ctx) => countWhere(db, EntityVersion, supersededVersionsWhere(ctx.cutoff('ENTITY_VERSION_DAYS'))),
        run: (db, ctx) => purgeSupersededVersions(db, ctx.cutoff('ENTITY_VERSION_DAYS')) },

    // 2. Old Update Logs (90 days — operational)
    { id: 'deletedLogsCount', summaryKey: 'update_logs_deleted', ecode: null, kind: 'delete', table: 'UpdateLog', durationKey: 'UPDATE_LOG_DAYS', tables: ['UpdateLog'],
        ...deleteStep(UpdateLog, (ctx) => lt(UpdateLog.ran_at, ctx.cutoff('UPDATE_LOG_DAYS'))) },

    // 3. AuditLog (365 days — CNIL recommendation 2021-122, not a legal obligation: R44 / E13). owner LAB audit: an emergency access (break-glass) still
    //    awaiting its review by another administrator is kept until reviewed — the « to review » list is computed from these rows
    { id: 'deletedAuditCount', summaryKey: 'audit_logs_deleted', ecode: 'E13', kind: 'delete', table: 'AuditLog', durationKey: 'AUDIT_LOG_DAYS', tables: ['AuditLog', 'LegalHold'],
        ...deleteStep(AuditLog, (ctx) => and(lt(AuditLog.timestamp, ctx.cutoff('AUDIT_LOG_DAYS')),
            sql`NOT (${AuditLog.action} = 'BREAK_GLASS_OPENED' AND NOT EXISTS (SELECT 1 FROM "AuditLog" r WHERE r.action = 'BREAK_GLASS_REVIEWED' AND r.entity_id = ${AuditLog.entity_id}))`,
            // D4 V2 (owner direction 08/11/2026): an ACTIVE e-mail suppression (HMAC of the address, never the address) is not deleted blindly at 12 months — it is
            // listed for review (step mailSuppressionsReview); once lifted by an administrator it follows the ordinary 12 months
            sql`NOT ${activeSuppressionSql(AuditLog)}`,
            sql`NOT ${heldSql(AuditLog.entity_id, AuditLog.actor_id, AuditLog.target)}`)) },   // R40 / G7: the trail of a held record is evidence

    // 4. Old Conversation Logs (90 days — the assistant, closed)
    { id: 'deletedConversationsCount', summaryKey: 'conversation_logs_deleted', ecode: null, kind: 'delete', table: 'ConversationLog', durationKey: 'CONVERSATION_LOG_DAYS', tables: ['ConversationLog'],
        ...deleteStep(ConversationLog, (ctx) => lt(ConversationLog.createdAt, ctx.cutoff('CONVERSATION_LOG_DAYS'))) },

    // 5. Old/Expired Shared Diagnostics (expired OR > 90 days). R44 / E11: a copy followed by an organization (ProCase / Referral, which CASCADE) is NOT
    //    deleted here — deleting it erased the organization's follow-up; step 5b redacts its content instead (separate approval)
    { id: 'deletedDiagnosticsCount', summaryKey: 'diagnostics_deleted', ecode: 'E11', kind: 'delete', table: 'SharedDiagnostic', durationKey: 'SHARED_DIAGNOSTIC_MAX_DAYS',
        tables: ['SharedDiagnostic', 'LegalHold', 'ProCase', 'Referral', 'SharedDossierThread', 'DSRRequest'],
        count: (db, ctx) => countWhere(db, SharedDiagnostic, sharedDiagnosticWhere(ctx, false)),
        run: async (db, ctx) => {
            const diagRes = await db.delete(SharedDiagnostic).where(sharedDiagnosticWhere(ctx, false))
                .returning({ id: SharedDiagnostic.id, results: SharedDiagnostic.results });
            const keys = (Array.isArray(diagRes) ? diagRes : []).flatMap((row) => storageKeysOf(row?.results));
            // DTA S8: the encrypted documents of a purged dossier are deleted from object storage too, after the commit (best effort; failures logged by key)
            return { count: affected(diagRes), afterCommit: async () => ((await purgeDossierFiles(keys)).failed.length > 0 ? 'dossierFilesPurge' : null) };
        } },

    // 5b. R44 / E11 — the same copies when an organization follows them: the row stays (the organization's ProCase / ProCaseNote / Referral keep their
    //     reference and are not cascaded), its content is emptied and its encrypted files deleted. Flagged: the follow-up itself is the structure's record.
    { id: 'diagnosticsRedactedWithFollowUp', summaryKey: 'diagnostics_redacted_with_follow_up', ecode: 'E11', kind: 'redact', table: 'SharedDiagnostic', durationKey: 'SHARED_DIAGNOSTIC_MAX_DAYS',
        tables: ['SharedDiagnostic', 'LegalHold', 'ProCase', 'Referral', 'SharedDossierThread', 'DSRRequest'], sharedController: 'ProCase / ProCaseNote / Referral / SharedDossierThread are kept (structure records)',
        count: (db, ctx) => countWhere(db, SharedDiagnostic, sharedDiagnosticWhere(ctx, true)),
        run: async (db, ctx) => {
            const rows = await db.select({ id: SharedDiagnostic.id, results: SharedDiagnostic.results }).from(SharedDiagnostic).where(sharedDiagnosticWhere(ctx, true)).for('update');
            if (rows.length === 0) return 0;
            await db.update(SharedDiagnostic).set({ situation: {}, results: { _redacted: 'r44-e11', redactedAt: ctx.now.toISOString() } })
                .where(inArray(SharedDiagnostic.id, rows.map((r) => r.id)));
            const keys = rows.flatMap((row) => storageKeysOf(row?.results));
            return { count: rows.length, afterCommit: async () => ((await purgeDossierFiles(keys)).failed.length > 0 ? 'dossierFilesPurge' : null) };
        } },

    // 6. Expired Auth Tokens
    { id: 'deletedTokensCount', summaryKey: 'tokens_deleted', ecode: null, kind: 'delete', table: 'AuthToken', durationKey: null, tables: ['AuthToken'],
        ...deleteStep(AuthToken, (ctx) => lt(AuthToken.expiresAt, ctx.now)) },

    // 6b. launch-readiness item 66: expired e-mail change requests (an encrypted pending address, single-use link)
    { id: 'deletedEmailChangeCount', summaryKey: 'email_change_requests_deleted', ecode: null, kind: 'delete', table: 'EmailChangeRequest', durationKey: null, tables: ['EmailChangeRequest'],
        ...deleteStep(EmailChangeRequest, (ctx) => lt(EmailChangeRequest.expiresAt, ctx.now)) },

    // 7. Old AI Metrics (90 days — non-personal, storage hygiene)
    { id: 'deletedAiMetricsCount', summaryKey: 'ai_metrics_deleted', ecode: null, kind: 'delete', table: 'AiMetric', durationKey: 'AI_METRIC_DAYS', tables: ['AiMetric'],
        ...deleteStep(AiMetric, (ctx) => lt(AiMetric.createdAt, ctx.cutoff('AI_METRIC_DAYS'))) },

    // 8. Consent Logs (1095 days / 3 years — proof, proposal). PKG-11 / C22: only SUPERSEDED rows — the latest decision of a subject for a purpose stays
    { id: 'deletedConsentLogsCount', summaryKey: 'consent_logs_deleted', ecode: 'E10', kind: 'delete', table: 'ConsentLog', durationKey: 'CONSENT_SUPERSEDED_DAYS', tables: ['ConsentLog', 'LegalHold'],
        count: (db, ctx) => countWhere(db, ConsentLog, supersededConsentsWhere(ctx.cutoff('CONSENT_SUPERSEDED_DAYS'))),
        run: (db, ctx) => purgeSupersededConsents(db, ctx.cutoff('CONSENT_SUPERSEDED_DAYS')) },

    // 8b. R44 / E10 — every consent row (the latest decision included) of a person whose account was ERASED (DSR DELETE completed, account gone) 12 months ago
    { id: 'consentLogsAfterErasureDeleted', summaryKey: 'consent_logs_after_erasure_deleted', ecode: 'E10', kind: 'delete', table: 'ConsentLog', durationKey: 'CONSENT_AFTER_ERASURE_DAYS',
        tables: ['ConsentLog', 'DSRRequest', 'CitizenUser', 'LegalHold'],
        ...deleteStep(ConsentLog, (ctx) => and(
            sql`EXISTS (SELECT 1 FROM "DSRRequest" r WHERE r."requestType" = 'DELETE' AND r.status = 'COMPLETED' AND r."subjectId" = ${ConsentLog.subject_id}
                AND r."completedAt" < ${ctx.cutoff('CONSENT_AFTER_ERASURE_DAYS')})`,
            sql`NOT EXISTS (SELECT 1 FROM "CitizenUser" u WHERE u.id = ${ConsentLog.subject_id})`,
            sql`NOT ${heldSql(ConsentLog.subject_id)}`)) },

    // 9. Expired User Consents
    { id: 'deletedUserConsentsCount', summaryKey: 'user_consents_deleted', ecode: null, kind: 'delete', table: 'UserConsent', durationKey: null, tables: ['UserConsent', 'LegalHold'],
        ...deleteStep(UserConsent, (ctx) => and(lt(UserConsent.expiresAt, ctx.now), sql`NOT ${heldSql(UserConsent.citizenId, UserConsent.structureId)}`)) },   // R40 / G7

    // 10. Expired Invitations (30-day grace after expiry)
    { id: 'deletedInvitationsCount', summaryKey: 'invitations_deleted', ecode: null, kind: 'delete', table: 'Invitation', durationKey: 'INVITATION_GRACE_DAYS', tables: ['Invitation', 'LegalHold'],
        ...deleteStep(Invitation, (ctx) => and(lt(Invitation.expires_at, ctx.cutoff('INVITATION_GRACE_DAYS')), sql`NOT ${heldSql(Invitation.structureId)}`)) },   // R40 / G7

    // 11. Expired ProOutlookTokens (30-day grace after expiry)
    { id: 'deletedOutlookTokensCount', summaryKey: 'outlook_tokens_deleted', ecode: null, kind: 'delete', table: 'ProOutlookToken', durationKey: 'OUTLOOK_TOKEN_GRACE_DAYS', tables: ['ProOutlookToken'],
        ...deleteStep(ProOutlookToken, (ctx) => lt(ProOutlookToken.expiresAt, ctx.cutoff('OUTLOOK_TOKEN_GRACE_DAYS'))) },

    // 12. Old Pro Audit Logs (365 days — CNIL recommendation 2021-122, not a legal obligation: R44 / E13)
    { id: 'deletedProAuditCount', summaryKey: 'pro_audit_logs_deleted', ecode: 'E13', kind: 'delete', table: 'ProAuditLog', durationKey: 'PRO_AUDIT_LOG_DAYS', tables: ['ProAuditLog', 'LegalHold'],
        ...deleteStep(ProAuditLog, (ctx) => and(lt(ProAuditLog.createdAt, ctx.cutoff('PRO_AUDIT_LOG_DAYS')),
            sql`NOT ${heldSql(ProAuditLog.entityId, ProAuditLog.proUserId, ProAuditLog.structureId)}`)) },   // R40 / G7

    // 13 / 13a / 13c / 13d / 13e. ProAppointments — R44 replaces the single « 730 days after createdAt, any status, account link kept » rule (E1–E5) by status-specific
    //     steps counted from the appointment DATE. Real anonymisation (E2): name, phone, e-mail, message AND the link to the account (citizenUserId) go;
    //     structure, service, date and status stay for statistics. R38 / R39: an account-free booking's sealed e-mail / phone, hashes and reminder consent go too.
    //     The set below is the one every anonymising step applies (guest columns only where they exist: migration 0043; 0044 for the reminder consent).
    ...appointmentSteps(),

    // 13b. R38: an account-free hold never confirmed is not a booking — one day after its 20-minute expiry its identity is cleared (the row stays,
    // cancelled, so the structure's history keeps its reference). R40 / G10: before migration 0043 no account-free hold can exist (skipped_steps).
    // R44 / E12: kept while LAB databases carry 0043 / 0044; removed with those columns.
    { id: 'clearedGuestHoldsCount', summaryKey: 'guest_holds_cleared', ecode: 'E12', kind: 'anonymise', table: 'ProAppointment', durationKey: 'GUEST_HOLD_DAYS',
        tables: ['ProAppointment', 'LegalHold'], requiresGuest: true, extraKeys: ['guest_decoy_holds_deleted'],
        count: async (db, ctx) => (await countWhere(db, ProAppointment, guestDecoyWhere(ctx))) + (await countWhere(db, ProAppointment, guestHoldWhere(ctx))),
        run: async (db, ctx) => {
            // R41-B: a decoy hold (the « already booked » answer: no personal data, never confirmable) is deleted at the same moment a real hold is cleared —
            // after that, confirm answers both exactly like an id that never existed; nothing of it is kept (no history, no statistic)
            const decoys = affected(await db.delete(ProAppointment).where(guestDecoyWhere(ctx)));
            const holds = affected(await db.update(ProAppointment)
                .set({ status: 'cancelled', cancelledAt: ctx.now, cancelledBy: 'GUEST_HOLD_EXPIRED', beneficiaryName: ANON, beneficiaryPhone: null, notes: null,
                    guestEmail: null, guestEmailHash: null, guestPhone: null, guestCodeHash: null, guestManageTokenHash: null,
                    ...(ctx.guestSchema.guestReminderConsent ? { guestReminderConsentAt: null } : {}) })
                .where(guestHoldWhere(ctx)));
            return { count: holds, extra: { guest_decoy_holds_deleted: decoys } };
        } },

    // 14. R44 / E8 — the notice ledger of an anonymised appointment (kind, recipient role, channel, status: no address, no text) goes with it
    { id: 'appointmentNoticesDeleted', summaryKey: 'appointment_notices_deleted', ecode: 'E8', kind: 'delete', table: 'AppointmentNotice', durationKey: 'APPOINTMENT_UNCONFIRMED_DAYS',
        tables: ['AppointmentNotice', 'ProAppointment', 'LegalHold'], dependsOn: ['anonymisedAppointmentsCount', 'appointmentsUnconfirmedAnonymised', 'appointmentsCancelledAnonymised'],
        ...deleteStep(AppointmentNotice, () => and(appointmentAnonymisedSql(AppointmentNotice.appointmentId), sql`NOT ${heldSql(AppointmentNotice.appointmentId)}`)) },

    // 15. R44 / E9 — appointment conversations: 2 years after the last message, or as soon as the appointment is anonymised. Messages, attachments and
    //     notification logs cascade; the attachments' encrypted files are deleted after the commit (same path as the DSR erasure).
    { id: 'rdvConversationsDeleted', summaryKey: 'rdv_conversations_deleted', ecode: 'E9', kind: 'delete', table: 'RdvConversation', durationKey: 'RDV_CONVERSATION_DAYS',
        tables: ['RdvConversation', 'RdvMessageAttachment', 'ProAppointment', 'LegalHold', 'DSRRequest'], dependsOn: ['anonymisedAppointmentsCount', 'appointmentsUnconfirmedAnonymised', 'appointmentsCancelledAnonymised'],
        // R45 / ENG-LR-9: the conversation also holds the STRUCTURE's messages (senderType PRO), attachments and notification logs, all CASCADE: flagged, so
        // its execution needs the written basis agreed with the structure (approvedSteps[id].sharedControllerBasis), like the other structure-record steps
        sharedController: 'RdvConversationMessage (structure messages included), RdvMessageAttachment, RdvNotificationLog cascade',
        count: (db, ctx) => countWhere(db, RdvConversation, conversationWhere(ctx)),
        run: async (db, ctx) => {
            // the conversations are locked first: an attachment added meanwhile waits for this transaction and then fails its foreign key (no orphan file)
            const ids = (await db.select({ id: RdvConversation.id }).from(RdvConversation).where(conversationWhere(ctx)).for('update')).map((r) => r.id);
            if (ids.length === 0) return 0;
            const keys = (await db.select({ k: RdvMessageAttachment.storageKey }).from(RdvMessageAttachment).where(inArray(RdvMessageAttachment.conversationId, ids))).map((r) => r.k);
            const n = affected(await db.delete(RdvConversation).where(inArray(RdvConversation.id, ids)));
            return { count: n, afterCommit: async () => ((await purgeDossierFiles(keys)).failed.length > 0 ? 'rdvAttachmentFilesPurge' : null) };
        } },

    // 16. R44 / E8 — in-app professional notifications, 6 months
    { id: 'proNotificationsDeleted', summaryKey: 'pro_notifications_deleted', ecode: 'E8', kind: 'delete', table: 'ProNotification', durationKey: 'PRO_NOTIFICATION_DAYS', tables: ['ProNotification', 'LegalHold'],
        ...deleteStep(ProNotification, (ctx) => and(lt(ProNotification.createdAt, ctx.cutoff('PRO_NOTIFICATION_DAYS')), sql`NOT ${heldSql(ProNotification.userId, ProNotification.structureId)}`)) },

    // 17. R44 / E8 — a device subscription FAILING for 30 days (no success since its last failure); 404 / 410 are already deleted by web-push.js
    { id: 'pushSubscriptionsFailingDeleted', summaryKey: 'push_subscriptions_failing_deleted', ecode: 'E8', kind: 'delete', table: 'PushSubscription', durationKey: 'PUSH_FAILING_DAYS', tables: ['PushSubscription', 'LegalHold'],
        ...deleteStep(PushSubscription, (ctx) => and(eq(PushSubscription.status, 'FAILING'), isNotNull(PushSubscription.lastFailureAt), lt(PushSubscription.lastFailureAt, ctx.cutoff('PUSH_FAILING_DAYS')),
            or(isNull(PushSubscription.lastSuccessAt), sql`${PushSubscription.lastSuccessAt} < ${PushSubscription.lastFailureAt}`), sql`NOT ${heldSql(PushSubscription.userId)}`)) },

    // 18. R44 / E9b — a RELEASED legal hold, 12 months after its release (an ACTIVE one is never touched)
    { id: 'legalHoldsReleasedDeleted', summaryKey: 'legal_holds_released_deleted', ecode: 'E9b', kind: 'delete', table: 'LegalHold', durationKey: 'LEGAL_HOLD_RELEASED_DAYS', tables: ['LegalHold'],
        ...deleteStep(LegalHold, (ctx) => and(eq(LegalHold.status, 'RELEASED'), isNotNull(LegalHold.releasedAt), lt(LegalHold.releasedAt, ctx.cutoff('LEGAL_HOLD_RELEASED_DAYS')))) },

    // 19. R44 / E9b — a closed support request, 12 months after closure
    { id: 'supportRequestsDeleted', summaryKey: 'support_requests_deleted', ecode: 'E9b', kind: 'delete', table: 'SupportRequest', durationKey: 'SUPPORT_REQUEST_DAYS', tables: ['SupportRequest', 'LegalHold'],
        ...deleteStep(SupportRequest, (ctx) => and(isNotNull(SupportRequest.closedAt), lt(SupportRequest.closedAt, ctx.cutoff('SUPPORT_REQUEST_DAYS')), sql`NOT ${heldSql(SupportRequest.id)}`)) },

    // 20. R44 / E9b — a finished rights request, 3 years after completion (proof of the answer). An erasure request is kept while consent rows of the
    //     erased person remain (step 8b needs it as the proof of the erasure), and it is the list replayed after a restore (E15, docs/runbooks.md § 4)
    { id: 'dsrRequestsDeleted', summaryKey: 'dsr_requests_deleted', ecode: 'E9b', kind: 'delete', table: 'DSRRequest', durationKey: 'DSR_REQUEST_DAYS', tables: ['DSRRequest', 'ConsentLog', 'LegalHold'],
        dependsOn: ['consentLogsAfterErasureDeleted'],
        ...deleteStep(DSRRequest, (ctx) => and(isNotNull(DSRRequest.completedAt), lt(DSRRequest.completedAt, ctx.cutoff('DSR_REQUEST_DAYS')), ne(DSRRequest.status, 'ACTIVE'),
            sql`NOT (${DSRRequest.requestType} = 'DELETE' AND EXISTS (SELECT 1 FROM "ConsentLog" c WHERE c.subject_id = ${DSRRequest.subjectId}))`,
            sql`NOT ${heldSql(DSRRequest.id, DSRRequest.subjectId)}`)) },

    // 21. R44 / E7 — REPORT ONLY: accounts without citizen activity for 24 months (last sign-in; an account never signed into counts from its creation —
    //     D4 V2, 08/11/2026: it used to be left out). Deleting is a later, separate decision (D4 V2 procedure: notice first, erasure engine — never this job).
    { id: 'inactiveAccountsReport', summaryKey: 'inactive_accounts_eligible', ecode: 'E7', kind: 'report', table: 'CitizenUser', durationKey: 'INACTIVE_ACCOUNT_DAYS', tables: ['CitizenUser'],
        count: (db, ctx) => countWhere(db, CitizenUser, sql`COALESCE(${CitizenUser.lastSeenAt}, ${CitizenUser.createdAt}) < ${ctx.cutoff('INACTIVE_ACCOUNT_DAYS')}`) },

    // 21b. D4 V2 (owner direction 08/11/2026) — REPORT ONLY: active e-mail suppressions (HMAC) older than 12 months, to REVIEW: an administrator lifts the ones
    //      no longer justified (they then follow the ordinary 12 months) or records why a block stays (deliverability, provider requirement, an individual case)
    { id: 'mailSuppressionsReview', summaryKey: 'mail_suppressions_to_review', ecode: 'D4-V2', kind: 'report', table: 'AuditLog', durationKey: 'MAIL_SUPPRESSION_REVIEW_DAYS', tables: ['AuditLog'],
        count: (db, ctx) => countWhere(db, AuditLog, and(activeSuppressionSql(AuditLog), lt(AuditLog.timestamp, ctx.cutoff('MAIL_SUPPRESSION_REVIEW_DAYS')))) },

    // 22. R44 / E9b — REPORT ONLY: disabled professional accounts. 0042 records no disabling date (updatedAt moves on any change), and a professional
    //     account is referenced by the structure's records (cases, notes, appointments): deletion is a shared decision with the structure.
    { id: 'disabledProUsersReport', summaryKey: 'disabled_pro_users_eligible', ecode: 'E9b', kind: 'report', table: 'ProUser', durationKey: 'PRO_USER_DISABLED_DAYS', tables: ['ProUser'],
        sharedController: 'professional accounts are referenced by structure records',
        count: (db, ctx) => countWhere(db, ProUser, and(eq(ProUser.status, 'disabled'), lt(ProUser.updatedAt, ctx.cutoff('PRO_USER_DISABLED_DAYS')))) },
];

/** @param {PurgeContext} ctx @param {boolean} followed */
function sharedDiagnosticWhere(ctx, followed) {
    return and(
        or(
            and(isNotNull(SharedDiagnostic.expiresAt), lt(SharedDiagnostic.expiresAt, ctx.now)),
            lt(SharedDiagnostic.createdAt, ctx.cutoff('SHARED_DIAGNOSTIC_MAX_DAYS'))
        ),
        // PKG-5 / A12: a dossier under an ACTIVE legal hold is never purged automatically
        sql`NOT EXISTS (SELECT 1 FROM "LegalHold" h WHERE h.status = 'ACTIVE' AND h."dataCategory" = 'SharedDiagnostic' AND h."recordId" = ${SharedDiagnostic.id})`,
        // R40 / G7: nor a dossier whose person is held, nor one followed in a held professional case
        sql`NOT ${heldSql(SharedDiagnostic.id, SharedDiagnostic.ownerCitizenId, SharedDiagnostic.privacySubjectId)}`,
        sql`NOT EXISTS (SELECT 1 FROM "LegalHold" h JOIN "ProCase" pc ON pc.id = h."recordId" WHERE h.status = 'ACTIVE' AND pc."sharedDiagnosticId" = ${SharedDiagnostic.id})`,
        // PKG-11 / C21: a dossier whose owner restricted processing (art. 18) is kept, not deleted automatically (storage only)
        sql`NOT ${restrictedDossierSql(SharedDiagnostic.id)}`,
        // R44: nor while the owner's access / review request is open
        sql`NOT ${openNonErasureDsrSql(SharedDiagnostic.ownerCitizenId)}`,
        // R44 / E11: followed by an organization => redacted (5b), never deleted with its follow-up
        followed ? and(hasFollowUpSql(SharedDiagnostic.id), sql`NOT (${SharedDiagnostic.results} ? '_redacted')`) : sql`NOT ${hasFollowUpSql(SharedDiagnostic.id)}`
    );
}

/** @param {PurgeContext} ctx */
function conversationWhere(ctx) {
    return and(
        or(sql`COALESCE(${RdvConversation.lastMessageAt}, ${RdvConversation.createdAt}) < ${ctx.cutoff('RDV_CONVERSATION_DAYS')}`, appointmentAnonymisedSql(RdvConversation.appointmentId)),
        sql`NOT ${heldSql(RdvConversation.id, RdvConversation.citizenUserId, RdvConversation.structureId, RdvConversation.appointmentId)}`,
        sql`NOT ${personProtectedSql(RdvConversation.citizenUserId)}`
    );
}

/** @param {PurgeContext} ctx */
const guestDecoyWhere = (ctx) => and(eq(ProAppointment.beneficiaryName, GUEST_DECOY_NAME), isNotNull(ProAppointment.guestHoldExpiresAt),
    lt(ProAppointment.guestHoldExpiresAt, ctx.cutoff('GUEST_HOLD_DAYS')), sql`NOT ${heldSql(ProAppointment.id, ProAppointment.structureId)}`);
/** @param {PurgeContext} ctx */
const guestHoldWhere = (ctx) => and(isNotNull(ProAppointment.guestHoldExpiresAt), lt(ProAppointment.guestHoldExpiresAt, ctx.cutoff('GUEST_HOLD_DAYS')),
    or(isNotNull(ProAppointment.guestEmail), ne(ProAppointment.beneficiaryName, ANON)), ne(ProAppointment.beneficiaryName, GUEST_DECOY_NAME),
    sql`NOT ${heldSql(ProAppointment.id, ProAppointment.structureId)}`);   // R40 / G7

/** The tables this database has (one read per run; Production is at 0042). @param {any} database */
async function existingTables(database) {
    const res = await database.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`);
    return new Set((res?.rows || res || []).map((r) => String(r.table_name)));
}

/**
 * One purge run. Dry run unless executionGate() allows execution; then only the approved steps execute. Returns the HTTP status and body.
 * @param {{ database?: any, policy?: any, env?: Record<string, string | undefined>, now?: Date, dryRunRequested?: boolean, logger?: any, steps?: PurgeStep[] }} [opts]
 */
export async function runGdprPurge(opts = {}) {
    const database = opts.database ?? defaultDb;
    const policy = opts.policy ?? RETENTION_POLICY;
    const env = opts.env ?? process.env;
    const log = opts.logger ?? defaultLogger;
    const steps = opts.steps ?? PURGE_STEPS;
    const now = opts.now ?? new Date();
    const gate = executionGate(policy, env, { dryRunRequested: opts.dryRunRequested === true });

    const failedSteps = [];
    const recordFailure = (/** @type {string} */ step, /** @type {any} */ err) => {
        failedSteps.push(step);
        log.error({ err, step }, '[gdpr-purge] retention step failed');
        Sentry.captureException(err);
    };

    const body = async (/** @type {boolean} */ execute) => {
        const startedAt = new Date();
        // R40 / G10: optional columns (guest booking, 0043 / 0044) and R44: the tables themselves — read once per run; missing => the step is skipped and said
        const skippedSteps = []; const notApproved = []; const blocked = []; const countErrors = []; const stepApprovalMissing = []; const ownerChoiceOpen = [];
        // a dry run only reads: a failed read is said in count_errors (a warning), never as a failed retention step
        const detectionFailed = (/** @type {any} */ err) => (execute ? recordFailure('schemaDetection', err)
            : (countErrors.push('schemaDetection'), log.warn({ err }, '[gdpr-purge] schema detection failed (dry run)')));
        let guestSchema = { guestBooking: false, guestReminderConsent: false };
        try { guestSchema = await appointmentGuestSchema(database); } catch (stepErr) { detectionFailed(stepErr); }
        /** @type {Set<string>} */ let tables = new Set();
        try { tables = await existingTables(database); } catch (stepErr) { detectionFailed(stepErr); }   // fail-closed: no table known => every step skipped
        const ctx = { now, policy, guestSchema, cutoff: (/** @type {string} */ key) => new Date(now.getTime() - policyDays(policy, key) * 86_400_000) };

        /** @type {Record<string, number>} */ const counters = {};
        const report = [];
        for (const step of steps) {
            counters[step.summaryKey] = 0;
            for (const k of step.extraKeys || []) counters[k] = 0;
            // R45: a step whose duration is an owner choice not yet made (A7) has no single cutoff — the dry run counts it once per option
            const choice = ownerChoiceOf(policy, step.durationKey);
            let choiceOpen = false;
            if (choice) { try { policyDays(policy, step.durationKey); } catch { choiceOpen = true; } }
            const line = { id: step.id, ecode: step.ecode, kind: step.kind, table: step.table, durationKey: step.durationKey,
                days: step.durationKey && !choiceOpen ? policyDays(policy, step.durationKey) : null, anchor: step.durationKey ? policy.durations[step.durationKey].anchor : 'expiry',
                ...(choice ? { ownerChoice: { id: choice.id, options: choice.options, made: !choiceOpen } } : {}),
                ...(step.sharedController ? { sharedController: step.sharedController } : {}),
                // R45: a dry run counts this step BEFORE the steps it depends on run — an execution also removes the rows of what they anonymise in the same run
                ...(step.dependsOn && !execute ? { countedBeforeDependencies: step.dependsOn } : {}), decision: 'dry-run', count: null };
            report.push(line);
            if (step.tables.some((t) => !tables.has(t)) || (step.requiresGuest && !guestSchema.guestBooking)) {
                skippedSteps.push(step.id); line.decision = 'skipped_schema'; continue;
            }
            if (choiceOpen) {
                ownerChoiceOpen.push(step.id); line.decision = 'owner_choice_required'; line.countsByOption = {};
                for (const option of choice.options) {
                    const octx = { ...ctx, cutoff: (/** @type {string} */ key) => new Date(now.getTime() - policyDays(policy, key, key === step.durationKey ? { option } : {}) * 86_400_000) };
                    try { line.countsByOption[String(option)] = await step.count(database, octx); } catch (countErr) { countErrors.push(step.id); log.warn({ err: countErr, step: step.id }, '[gdpr-purge] dry-run count failed'); }
                }
                continue;
            }
            // R45 / ENG-LR-9: listed by the operator AND approved by the controller in the policy (per step: dry run read, backup verified, written agreement)
            const listed = gate.approvedSteps.has(step.id);
            const approvalProblem = execute && listed && step.kind !== 'report' ? stepApprovalProblem(policy, step) : null;
            if (approvalProblem) { stepApprovalMissing.push({ id: step.id, reason: approvalProblem }); line.decision = 'not_approved_in_policy'; line.approvalProblem = approvalProblem; }
            const runIt = execute && step.kind !== 'report' && typeof step.run === 'function' && listed && !approvalProblem;
            if (runIt && (step.dependsOn || []).some((d) => failedSteps.includes(d))) { blocked.push(step.id); line.decision = 'blocked_by_failed_dependency'; continue; }
            if (runIt) {
                try {
                    const out = await database.transaction(async (tx) => step.run(tx, ctx));
                    const n = typeof out === 'number' ? out : Number(out?.count ?? 0);
                    counters[step.summaryKey] = n; line.count = n; line.decision = 'executed';
                    for (const [k, v] of Object.entries(out?.extra || {})) counters[k] = v;
                    if (out?.afterCommit) { const extraFailure = await out.afterCommit().catch(() => 'filesPurge'); if (extraFailure) failedSteps.push(extraFailure); }
                } catch (stepErr) { recordFailure(step.id, stepErr); line.decision = 'failed'; }
                continue;
            }
            if (execute && step.kind !== 'report') notApproved.push(step.id);
            if (step.kind === 'report') line.decision = 'report_only';
            if (approvalProblem) line.decision = 'not_approved_in_policy';
            try { line.count = await step.count(database, ctx); } catch (countErr) { countErrors.push(step.id); log.warn({ err: countErr, step: step.id }, '[gdpr-purge] dry-run count failed'); }
        }

        const out = {
            mode: execute ? 'execute' : 'dry-run',
            policy: policySummary(policy),
            ...(execute ? counters : {}),
            ...(execute ? { status: failedSteps.length === 0 ? 'success' : 'partial_failure' } : {}),
            ...(failedSteps.length ? { failed_steps: failedSteps } : {}),
            ...(skippedSteps.length ? { skipped_steps: skippedSteps } : {}),
            ...(notApproved.length ? { not_approved_steps: notApproved } : {}),
            ...(stepApprovalMissing.length ? { step_approval_missing: stepApprovalMissing } : {}),
            ...(ownerChoiceOpen.length ? { owner_choice_required_steps: ownerChoiceOpen } : {}),
            ...(blocked.length ? { blocked_steps: blocked } : {}),
            ...(countErrors.length ? { count_errors: countErrors } : {}),
            steps: report,
        };
        if (execute) {
            // R44: evidence of the run (counts and step ids only — never a value, an address or an identifier of a person)
            try {
                await database.insert(AuditLog).values({ action: 'GDPR_PURGE_RUN', actor: 'cron/gdpr-purge', entity: 'RetentionPolicy', entity_id: policy.version,
                    details: { policyVersion: policy.version, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), status: out.status,
                        executed: Object.fromEntries(report.filter((l) => l.decision === 'executed').map((l) => [l.id, l.count])),
                        failed: failedSteps, skipped: skippedSteps, notApproved, blocked, stepApprovalMissing: stepApprovalMissing.map((x) => x.id), ownerChoices: policy.approvedChoices ?? null } });
                out.audit_evidence = 'written';
            } catch (auditErr) { recordFailure('auditEvidence', auditErr); out.audit_evidence = 'failed'; out.status = 'partial_failure'; out.failed_steps = failedSteps; }
        }
        // launch-readiness item 62: what no job deletes yet, counted (never deleted here)
        const retention = await import('../../_services/retention.js').then((m) => m.retentionReport(database)).catch(() => null);
        out.retention_report = retention ? retention.items.map(({ key, durationDays, total, overdue }) => ({ key, durationDays, total, overdue })) : null;
        return out;
    };

    if (!gate.execute) {
        // R33 + R44: nothing is changed or written; the counts say what an approved run would do
        const out = await body(false);
        const message = gate.reason === 'GDPR_PURGE_DISABLED'
            ? 'Purge disabled until GDPR_PURGE_ENABLED=true (retention periods must be approved first). Nothing deleted.'
            : gate.reason === 'OWNER_CHOICE_MISSING'
                ? 'Dry run: an owner choice of the retention policy (A7) is not made, or not named in the approved version. Nothing deleted.'
                : 'Dry run: the retention policy is not approved for execution (or this run asked for a dry run). Nothing deleted.';
        return { status: 200, body: { skipped: true, reason: gate.reason, message, ...out } };
    }

    // R40 / G7: one purge at a time (two overlapping runs would double-count and race on the blob deletions). The lock is held by this transaction for the whole
    // run; each step runs in its own transaction on `database` (committed or rolled back on its own: per-step recovery), like referral-timeouts.
    return database.transaction(async (lockTx) => {
        const [lock] = (await lockTx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('ada:gdpr-purge')) AS ok`)).rows;
        if (!lock?.ok) return { status: 409, body: { skipped: true, reason: 'ALREADY_RUNNING', message: 'Another purge is running. Nothing deleted.' } };
        log.info(`🧹 Starting GDPR Purge (policy ${policy.version})...`);
        const out = await body(true);
        log.info('✅ GDPR Purge complete:', { status: out.status, failed_steps: out.failed_steps, skipped_steps: out.skipped_steps });
        return { status: failedSteps.length === 0 ? 200 : 500, body: out };
    });
}

/**
 * The HTTP handler for a given policy. Production uses the default export (the frozen PROPOSED policy of api/_services/retention-policy.js); tests build a
 * handler with a test copy marked approved — no production module calls this factory with another policy (unit-tested source pin).
 * @param {{ policy?: any }} [deps]
 */
export function createGdprPurgeHandler(deps = {}) {
    /**
     * @param {import('../../_utils/http-types').ApiRequest} req
     * @param {import('../../_utils/http-types').ApiResponse} res
     */
    return async function gdprPurgeHandler(req, res) {
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
        const dryRunRequested = ['1', 'true', 'yes'].includes(String(req.query?.dryRun ?? req.query?.dry_run ?? '').toLowerCase());
        try {
            const { status, body } = await runGdprPurge({ policy: deps.policy ?? RETENTION_POLICY, dryRunRequested });
            return res.status(status).json(body);
        } catch (e) {
            defaultLogger.error('GDPR Purge Failed:', e);
            Sentry.captureException(e);
            return res.status(500).json({ error: 'GDPR_PURGE_FAILED' });   // R38: the raw error stays in the logs and Sentry, not in the response
        }
    };
}

export default createGdprPurgeHandler();
