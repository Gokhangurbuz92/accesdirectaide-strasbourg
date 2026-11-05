/**
 * R44 — policy-driven GDPR purge (R43 dossier § 3.3, E1–E16). Unit level (no database): the versioned policy is PROPOSED — NOT APPROVED and cannot run;
 * the execution gate (E16, per step); dry run by default (no write of any kind); only approved steps execute; report-only steps never execute; missing
 * tables are skipped and said (0042); a failed step blocks the steps that depend on it; the SQL of each step uses the canonical anchors and discriminants.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/_services/retention.js', () => ({ retentionReport: async () => ({ items: [] }) }));

import {
  RETENTION_POLICY, POLICY_STATUS_PROPOSED, isPolicyApproved, executionGate, approvedStepsFromEnv, policyDays,
} from '../../api/_services/retention-policy.js';
import { RETENTION, PURGE_STEPS, runGdprPurge, anonymisationSet } from '../../api/_handlers/cron/gdpr-purge.js';
import { approvedTestPolicy, approvalEnv, executableStepIds, TEST_POLICY_VERSION } from '../helpers/gdpr-purge-approval.js';

const ALL_TABLES = ['EntityVersion', 'UpdateLog', 'AuditLog', 'ConversationLog', 'SharedDiagnostic', 'AuthToken', 'EmailChangeRequest', 'AiMetric', 'ConsentLog', 'UserConsent',
  'Invitation', 'ProOutlookToken', 'ProAuditLog', 'ProAppointment', 'AppointmentNotice', 'RdvConversation', 'RdvMessageAttachment', 'ProNotification', 'PushSubscription',
  'LegalHold', 'SupportRequest', 'DSRRequest', 'CitizenUser', 'ProUser', 'ProCase', 'Referral', 'SharedDossierThread'];   // R45: SharedDossierThread (E11 follow-up) exists on 0042
const dialect = new PgDialect();
const render = (w) => dialect.sqlToQuery(w).sql;
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** a recording drizzle-like database: every write and every count is recorded with its table and WHERE */
function recDb({ tables = ALL_TABLES, guest = false, failTable = null, lockOk = true } = {}) {
  const calls = [];
  const finish = (entry, result) => {
    calls.push(entry);
    if (failTable && entry.table === failTable && entry.op !== 'select') return Object.assign(Promise.reject(new Error('boom')), { returning: async () => { throw new Error('boom'); } });
    const p = Promise.resolve(result);
    return Object.assign(p, { returning: async () => [], for: async () => [] });
  };
  const db = {
    calls,
    delete: (t) => ({ where: (w) => finish({ op: 'delete', table: getTableName(t), where: w }, { rowCount: 2 }) }),
    update: (t) => ({ set: (set) => ({ where: (w) => finish({ op: 'update', table: getTableName(t), set, where: w }, { rowCount: 1 }) }) }),
    select: () => { const e = { op: 'select' }; const c = { from: (t) => { e.table = getTableName(t); return c; }, innerJoin: () => c, where: (w) => { e.where = w; return finish(e, [{ n: 3 }]); } }; return c; },
    insert: (t) => ({ values: async (v) => { calls.push({ op: 'insert', table: getTableName(t), values: v }); return { rowCount: 1 }; } }),
    execute: async () => ({ rows: [{ ok: lockOk }, ...tables.map((table_name) => ({ table_name })), ...(guest ? ['guestEmail', 'guestEmailHash', 'guestPhone', 'guestMailConsentAt', 'guestHoldExpiresAt',
      'guestCodeHash', 'guestCodeAttempts', 'guestConfirmedAt', 'guestManageTokenHash', 'guestManageExpiresAt', 'guestReminderConsentAt'].map((column_name) => ({ column_name })) : [])] }),
  };
  db.transaction = async (fn) => fn(db);
  return db;
}
const writes = (db) => db.calls.filter((c) => c.op !== 'select');
const NOW = new Date('2026-11-04T12:00:00Z');

describe('R44 retention policy object', () => {
  it('is PROPOSED — NOT APPROVED, without approvedPolicyVersion, frozen, and not approved', () => {
    expect(RETENTION_POLICY.status).toBe(POLICY_STATUS_PROPOSED);
    expect(RETENTION_POLICY.status).toBe('PROPOSED — NOT APPROVED');
    expect('approvedPolicyVersion' in RETENTION_POLICY).toBe(false);
    expect(isPolicyApproved(RETENTION_POLICY)).toBe(false);
    expect(Object.isFrozen(RETENTION_POLICY) && Object.isFrozen(RETENTION_POLICY.durations) && Object.isFrozen(RETENTION_POLICY.durations.AUDIT_LOG_DAYS)).toBe(true);
    expect(RETENTION_POLICY.source).toMatch(/R43_DOSSIER_RGPD_ACTIVATION_FR\.md § 3\.1/);
  });
  it('approval needs status APPROVED AND approvedPolicyVersion equal to the version', () => {
    expect(isPolicyApproved({ ...RETENTION_POLICY, status: 'APPROVED' })).toBe(false);
    expect(isPolicyApproved({ ...RETENTION_POLICY, approvedPolicyVersion: RETENTION_POLICY.version })).toBe(false);
    expect(isPolicyApproved({ ...RETENTION_POLICY, status: 'APPROVED', approvedPolicyVersion: 'r44-other' })).toBe(false);
    expect(isPolicyApproved(approvedTestPolicy())).toBe(true);
  });
  it('carries the R43 § 3.1 proposals (values) and stays equal to the RETENTION constants of the registry', () => {
    const d = (k) => policyDays(RETENTION_POLICY, k);
    // R45: A7 (APPOINTMENT_CONFIRMED_DAYS) is an owner choice with no default (D4 v2): 365 or 730 — see tests/unit/r45-purge-readiness.test.js
    expect(() => d('APPOINTMENT_CONFIRMED_DAYS')).toThrow(/owner choice A7/);
    expect(policyDays(approvedTestPolicy(), 'APPOINTMENT_CONFIRMED_DAYS')).toBe(730);
    expect([d('APPOINTMENT_UNCONFIRMED_DAYS'), d('APPOINTMENT_CANCELLED_DAYS'), d('APPOINTMENT_MESSAGE_DAYS')]).toEqual([90, 90, 30]);
    expect([d('PRO_NOTIFICATION_DAYS'), d('PUSH_FAILING_DAYS'), d('RDV_CONVERSATION_DAYS'), d('LEGAL_HOLD_RELEASED_DAYS'), d('SUPPORT_REQUEST_DAYS'), d('DSR_REQUEST_DAYS')]).toEqual([180, 30, 730, 365, 365, 1095]);
    expect([d('CONSENT_SUPERSEDED_DAYS'), d('CONSENT_AFTER_ERASURE_DAYS'), d('INACTIVE_ACCOUNT_DAYS'), d('BACKUP_KEEP_DAYS'), d('BACKUP_KEEP_WEEKLY')]).toEqual([1095, 365, 730, 30, 4]);
    expect(d('AUDIT_LOG_DAYS')).toBe(RETENTION.AUDIT_LOG_DAYS);
    expect(d('PRO_AUDIT_LOG_DAYS')).toBe(RETENTION.PRO_AUDIT_LOG_DAYS);
    expect(d('CONVERSATION_LOG_DAYS')).toBe(RETENTION.CONVERSATION_LOG_DAYS);
    expect(d('AI_METRIC_DAYS')).toBe(RETENTION.AI_METRIC_DAYS);
    expect(d('ENTITY_VERSION_DAYS')).toBe(RETENTION.ENTITY_VERSION_DAYS);
    expect(d('CONSENT_SUPERSEDED_DAYS')).toBe(RETENTION.CONSENT_LOG_DAYS);
    expect(d('INVITATION_GRACE_DAYS')).toBe(RETENTION.INVITATION_GRACE_DAYS);
    expect(d('OUTLOOK_TOKEN_GRACE_DAYS')).toBe(RETENTION.OUTLOOK_TOKEN_GRACE_DAYS);
    expect(RETENTION_POLICY.durations.APPOINTMENT_CONFIRMED_DAYS.options).toContain(RETENTION.APPOINTMENT_ANON_DAYS);   // R45: the registry shows an option, not a choice
    expect(d('GUEST_HOLD_DAYS')).toBe(RETENTION.GUEST_HOLD_DAYS);
    expect(() => policyDays(RETENTION_POLICY, 'NOPE')).toThrow();
  });
  it('E13: no « legal obligation » label is left on the purge durations', () => {
    const src = fs.readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
    expect(src).not.toMatch(/Legal obligation \(Art|\(legal obligation\)|— legal obligation\)/);
    expect(src).toMatch(/CNIL recommendation 2021-122/);
    expect(fs.readFileSync('docs/rgpd.md', 'utf8')).not.toMatch(/Obligation légale \(Art 6\.1\.c\) \| 365/);
  });
});

describe('R44 / E16 execution gate', () => {
  const ok = approvalEnv(['deletedTokensCount']);
  it('refuses in order: disabled, dry run requested, policy not approved, version not pinned, no approved step', () => {
    expect(executionGate(approvedTestPolicy(), {}).reason).toBe('GDPR_PURGE_DISABLED');
    expect(executionGate(approvedTestPolicy(), { ...ok, GDPR_PURGE_ENABLED: '1' }).reason).toBe('GDPR_PURGE_DISABLED');
    expect(executionGate(approvedTestPolicy(), ok, { dryRunRequested: true }).reason).toBe('DRY_RUN_REQUESTED');
    expect(executionGate(RETENTION_POLICY, ok).reason).toBe('POLICY_NOT_APPROVED');
    expect(executionGate(approvedTestPolicy(), { ...ok, GDPR_PURGE_POLICY_VERSION: 'r44-proposal-0' }).reason).toBe('POLICY_VERSION_NOT_PINNED');
    expect(executionGate(approvedTestPolicy(), { ...ok, GDPR_PURGE_APPROVED_STEPS: '' }).reason).toBe('NO_APPROVED_STEPS');
    expect(executionGate(approvedTestPolicy(), { ...ok, GDPR_PURGE_APPROVED_STEPS: '*' }).reason).toBe('NO_APPROVED_STEPS');   // no wildcard
    expect(executionGate(approvedTestPolicy(), ok)).toMatchObject({ execute: true, reason: null });
  });
  it('the approved-steps list is explicit (comma or space separated)', () => {
    expect([...approvedStepsFromEnv({ GDPR_PURGE_APPROVED_STEPS: ' a, b  c,,' })]).toEqual(['a', 'b', 'c']);
  });
  it('step ids are unique; report steps are E7 / E9b; every step names its duration in the policy (or an expiry)', () => {
    const ids = PURGE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PURGE_STEPS.filter((s) => s.kind === 'report').map((s) => [s.id, s.ecode])).toEqual([['inactiveAccountsReport', 'E7'], ['disabledProUsersReport', 'E9b']]);
    for (const s of PURGE_STEPS) if (s.durationKey) expect(() => policyDays(approvedTestPolicy(), s.durationKey), s.id).not.toThrow();   // R45: A7 resolved in the approved copy
  });
});

describe('R44 runGdprPurge — dry run by default, execution only of approved steps', () => {
  it('the production policy with GDPR_PURGE_ENABLED=true: a dry run, nothing written (no delete, update, insert), every step counted', async () => {
    const db = recDb();
    const { status, body } = await runGdprPurge({ database: db, env: { GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_APPROVED_STEPS: executableStepIds(PURGE_STEPS).join(','),
      GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version }, now: NOW, logger: log });
    expect(status).toBe(200);
    expect(body).toMatchObject({ skipped: true, reason: 'POLICY_NOT_APPROVED', mode: 'dry-run', policy: { status: 'PROPOSED — NOT APPROVED', approved: false, approvedPolicyVersion: null } });
    expect(writes(db)).toEqual([]);
    expect(body.steps.length).toBe(PURGE_STEPS.length);
    expect(body.steps.filter((l) => l.decision === 'dry-run' || l.decision === 'report_only').every((l) => l.count === 3)).toBe(true);
    // R45: the A7 steps (owner choice open) are counted once per option, never executed
    expect(body.steps.filter((l) => l.decision === 'owner_choice_required').map((l) => [l.id, l.countsByOption])).toEqual([
      ['anonymisedAppointmentsCount', { 365: 3, 730: 3 }], ['appointmentsStructureRecordAnonymised', { 365: 3, 730: 3 }]]);
    expect(body.steps.find((l) => l.id === 'clearedGuestHoldsCount').decision).toBe('skipped_schema');   // a 0042 database: no guest columns
    expect(body.status).toBeUndefined();
  });
  it('approved policy, ONE approved step: only that step writes; the others are counted and listed as not approved; one evidence row', async () => {
    const db = recDb();
    const { status, body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(['deletedTokensCount']), now: NOW, logger: log });
    expect(status).toBe(200);
    expect(body.mode).toBe('execute');
    expect(body.tokens_deleted).toBe(2);
    const w = writes(db);
    expect(w.map((c) => `${c.op}:${c.table}`)).toEqual(['delete:AuthToken', 'insert:AuditLog']);
    const evidence = w[1].values;
    expect(evidence).toMatchObject({ action: 'GDPR_PURGE_RUN', entity: 'RetentionPolicy', entity_id: TEST_POLICY_VERSION });
    expect(evidence.details.executed).toEqual({ deletedTokensCount: 2 });
    expect(JSON.stringify(evidence)).not.toMatch(/@|beneficiary|notes/);
    expect(body.not_approved_steps).toContain('anonymisedAppointmentsCount');
    expect(body.not_approved_steps).not.toContain('inactiveAccountsReport');
    expect(body.audit_evidence).toBe('written');
  });
  it('a report-only step never executes, even when listed', async () => {
    const db = recDb();
    const { body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(['inactiveAccountsReport', 'disabledProUsersReport']), now: NOW, logger: log });
    expect(writes(db).map((c) => c.op)).toEqual(['insert']);   // the evidence row only
    expect(body.steps.find((l) => l.id === 'inactiveAccountsReport')).toMatchObject({ decision: 'report_only', count: 3 });
  });
  it('a dry run requested by the caller writes nothing even when everything is approved', async () => {
    const db = recDb();
    const { body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(executableStepIds(PURGE_STEPS)), now: NOW, dryRunRequested: true, logger: log });
    expect([body.reason, writes(db).length]).toEqual(['DRY_RUN_REQUESTED', 0]);
  });
  it('a run while another holds the lock: 409 ALREADY_RUNNING, nothing written', async () => {
    const db = recDb({ lockOk: false });
    const { status, body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(executableStepIds(PURGE_STEPS)), now: NOW, logger: log });
    expect([status, body.reason, writes(db).length]).toEqual([409, 'ALREADY_RUNNING', 0]);
  });
  it('0042 / missing tables: steps needing them are skipped and said; the others run', async () => {
    const db = recDb({ tables: ALL_TABLES.filter((t) => t !== 'PushSubscription' && t !== 'ProNotification') });
    const { status, body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(executableStepIds(PURGE_STEPS)), now: NOW, logger: log });
    expect(status).toBe(200);
    expect(body.skipped_steps).toEqual(['clearedGuestHoldsCount', 'proNotificationsDeleted', 'pushSubscriptionsFailingDeleted']);
    expect(writes(db).some((c) => c.table === 'PushSubscription' || c.table === 'ProNotification')).toBe(false);
  });
  it('schema detection failure is fail-closed: every step skipped, the run reported as partial', async () => {
    const db = recDb(); db.execute = async () => { throw new Error('no catalog'); };
    db.transaction = async (fn) => fn({ ...db, execute: async () => ({ rows: [{ ok: true }] }) });
    const { status, body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(executableStepIds(PURGE_STEPS)), now: NOW, logger: log });
    expect(status).toBe(500);
    expect(body.skipped_steps.length).toBe(PURGE_STEPS.length);
    expect(writes(db).map((c) => c.op)).toEqual(['insert']);
  });
  it('a failed anonymisation blocks the steps that depend on it (notices, conversations); the step is rolled back alone and retried next run', async () => {
    const db = recDb({ failTable: 'ProAppointment' });
    const { status, body } = await runGdprPurge({ database: db, policy: approvedTestPolicy(), env: approvalEnv(executableStepIds(PURGE_STEPS)), now: NOW, logger: log });
    expect(status).toBe(500);
    expect(body.failed_steps).toEqual(expect.arrayContaining(['anonymisedAppointmentsCount', 'appointmentsUnconfirmedAnonymised', 'appointmentsCancelledAnonymised']));
    expect(body.blocked_steps).toEqual(['appointmentNoticesDeleted', 'rdvConversationsDeleted']);
    expect(body.tokens_deleted).toBe(2);   // independent steps still ran
    expect(body.steps.find((l) => l.id === 'appointmentNoticesDeleted').decision).toBe('blocked_by_failed_dependency');
  });
});

describe('R44 step SQL — anchors and discriminants of the canonical E-items', () => {
  const ctx = { now: NOW, policy: approvedTestPolicy(), guestSchema: { guestBooking: false, guestReminderConsent: false },
    cutoff: (k) => new Date(NOW.getTime() - policyDays(approvedTestPolicy(), k) * 86_400_000) };   // R45: A7 resolved (test value 730)
  const whereOf = async (id, c = ctx) => {
    const db = recDb(); const step = PURGE_STEPS.find((s) => s.id === id); await step.count(db, c);
    return render(db.calls.find((x) => x.op === 'select').where);
  };
  it('E1: confirmed appointments count from startAt (not createdAt); E2: the anonymisation unlinks the account', async () => {
    const w = await whereOf('anonymisedAppointmentsCount');
    expect(w).toMatch(/"ProAppointment"\."startAt" < \$/);
    expect(w).not.toMatch(/"createdAt"/);
    expect(w).toMatch(/NOT IN \('refused', 'expired', 'requested', 'cancelled'\)/);
    const set = anonymisationSet(ctx);
    expect(set).toMatchObject({ beneficiaryName: '[anonymisé]', beneficiaryPhone: null, citizenEmailSnapshot: null, notes: null, citizenUserId: null });
    expect(render(set.status)).toMatch(/WHEN "ProAppointment"\."status" = 'requested'/);   // E4
    expect(anonymisationSet({ ...ctx, guestSchema: { guestBooking: true, guestReminderConsent: true } })).toMatchObject({ guestEmail: null, guestReminderConsentAt: null });
  });
  it('E3 / E4: unconfirmed requests (refused, expired, requested after start) and cancellations have their own steps', async () => {
    const u = await whereOf('appointmentsUnconfirmedAnonymised');
    expect(u).toMatch(/"ProAppointment"\."status" in \(\$\d+, \$\d+\)/);
    expect(u).toMatch(/"ProAppointment"\."status" = \$\d+ and "ProAppointment"\."startAt" < \$/);
    expect(await whereOf('appointmentsCancelledAnonymised')).toMatch(/COALESCE\("ProAppointment"\."cancelledAt", "ProAppointment"\."startAt"\) < \$/);
  });
  it('E5: the message step uses the safe discriminant citizenUserId IS NOT NULL and only nulls notes', async () => {
    const w = await whereOf('appointmentMessagesErased');
    expect(w).toMatch(/"ProAppointment"\."citizenUserId" is not null/);
    expect(w).toMatch(/LEAST\("ProAppointment"\."startAt", "ProAppointment"\."cancelledAt"\)/);
    const db = recDb(); await PURGE_STEPS.find((s) => s.id === 'appointmentMessagesErased').run(db, ctx);
    expect(db.calls[0].set).toEqual({ notes: null });
  });
  it('every person-linked appointment step honours legal holds, restriction (art. 18) and an open access request', async () => {
    for (const id of ['appointmentMessagesErased', 'appointmentsUnconfirmedAnonymised', 'appointmentsCancelledAnonymised', 'anonymisedAppointmentsCount', 'appointmentsStructureRecordAnonymised']) {
      const w = await whereOf(id);
      expect(w, id).toMatch(/"LegalHold" h WHERE h\.status = 'ACTIVE'/);
      expect(w, id).toMatch(/"requestType" = \$\d+ AND r\.status = 'ACTIVE'/);   // RESTRICT
      expect(w, id).toMatch(/"requestType" <> 'DELETE'/);   // open non-erasure request
    }
  });
  it('E11: the 90-day shared-copy deletion skips copies followed by an organization; the redaction step handles those', async () => {
    expect(await whereOf('deletedDiagnosticsCount')).toMatch(/NOT \(EXISTS \(SELECT 1 FROM "ProCase" pc/);
    const r = await whereOf('diagnosticsRedactedWithFollowUp');
    expect(r).not.toMatch(/NOT \(EXISTS \(SELECT 1 FROM "ProCase" pc/);
    expect(r).toMatch(/\(EXISTS \(SELECT 1 FROM "ProCase" pc[\s\S]*NOT \("SharedDiagnostic"\."results" \? '_redacted'\)/);
  });
  it('E10: consents of an erased person go 12 months after the erasure, only when the account is gone', async () => {
    const w = await whereOf('consentLogsAfterErasureDeleted');
    expect(w).toMatch(/r\."requestType" = 'DELETE' AND r\.status = 'COMPLETED'/);
    expect(w).toMatch(/NOT EXISTS \(SELECT 1 FROM "CitizenUser" u/);
  });
  it('E8 / E9: notices and conversations follow the anonymisation; failing push subscriptions after 30 days', async () => {
    expect(await whereOf('appointmentNoticesDeleted')).toMatch(/a\."beneficiaryName" = \$\d+\s+AND a\."citizenUserId" IS NULL/);
    expect(await whereOf('rdvConversationsDeleted')).toMatch(/COALESCE\("RdvConversation"\."lastMessageAt", "RdvConversation"\."createdAt"\) < \$/);
    expect(await whereOf('pushSubscriptionsFailingDeleted')).toMatch(/"PushSubscription"\."status" = \$\d+/);
  });
});

describe('R44 source pins', () => {
  it('no production module builds the purge handler with another policy', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]));
    const users = ['api', 'src', 'scripts'].flatMap(walk).filter((f) => /\.(m?js|jsx|ts)$/.test(f) && !/\.test\./.test(f) && fs.readFileSync(f, 'utf8').includes('createGdprPurgeHandler'));
    expect(users).toEqual(['api/_handlers/cron/gdpr-purge.js']);
    expect(fs.readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8')).toMatch(/export default createGdprPurgeHandler\(\);/);
  });
});
