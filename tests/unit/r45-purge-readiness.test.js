/**
 * R45 / ENG-LR-9 — purge readiness (unit, no database). The Production purge stays CLOSED: the policy is PROPOSED — NOT APPROVED. What R45 adds:
 *   - A7 (completed appointments: 1 or 2 years after startAt) is an OWNER CHOICE with no default; approval is impossible until it is made, it must be one
 *     of the two options, and the approved version string must name it; while open, the dry run counts the A7 steps once per option;
 *   - each step needs its own approval in the policy (dry run read, backup verified, written agreement; the structure basis for a shared-controller step),
 *     on top of the operator list GDPR_PURGE_APPROVED_STEPS (the 4-condition gate is unchanged);
 *   - cascades: a shared copy with a structure's SharedDossierThread is never deleted (redacted instead); the conversation step is flagged shared-controller;
 *   - backup / erasure-replay interaction: the erasure proofs outlive every backup; the replay script uses the purge's open-request statuses;
 *   - the legacy scripts/cron-purge.js no longer purges on its own.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/_services/retention.js', () => ({ retentionReport: async () => ({ items: [] }) }));

import {
  RETENTION_POLICY, POLICY_STATUS_APPROVED, OWNER_CHOICE_REQUIRED, executionGate, isPolicyApproved, missingOwnerChoices, policyDays, stepApprovalProblem, choiceTag,
} from '../../api/_services/retention-policy.js';
import { PURGE_STEPS, OPEN_DSR_STATUSES, hasFollowUpSql, runGdprPurge } from '../../api/_handlers/cron/gdpr-purge.js';
import { OPEN_REQUEST_STATUSES } from '../../scripts/db-erasure-replay.mjs';
import { approvedTestPolicy, approvalEnv, executableStepIds, testPolicyVersion, TEST_STEP_APPROVAL } from '../helpers/gdpr-purge-approval.js';

const dialect = new PgDialect();
const NOW = new Date('2026-11-05T12:00:00Z');
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const TABLES = [...new Set(PURGE_STEPS.flatMap((s) => s.tables))];
function recDb() {
  const calls = [];
  const finish = (entry, result) => { calls.push(entry); return Object.assign(Promise.resolve(result), { returning: async () => [], for: async () => [] }); };
  const db = {
    calls,
    delete: (t) => ({ where: (w) => finish({ op: 'delete', table: getTableName(t), where: w }, { rowCount: 2 }) }),
    update: (t) => ({ set: (set) => ({ where: (w) => finish({ op: 'update', table: getTableName(t), set, where: w }, { rowCount: 1 }) }) }),
    select: () => { const e = { op: 'select' }; const c = { from: (t) => { e.table = getTableName(t); return c; }, innerJoin: () => c, where: (w) => { e.where = w; return finish(e, [{ n: 3 }]); } }; return c; },
    insert: (t) => ({ values: async (v) => { calls.push({ op: 'insert', table: getTableName(t), values: v }); return { rowCount: 1 }; } }),
    execute: async () => ({ rows: [{ ok: true }, ...TABLES.map((table_name) => ({ table_name }))] }),
  };
  db.transaction = async (fn) => fn(db);
  return db;
}
const writes = (db) => db.calls.filter((c) => c.op !== 'select');
const A7_STEPS = ['anonymisedAppointmentsCount', 'appointmentsStructureRecordAnonymised'];

describe('A7 — an owner choice that blocks approval until it is made', () => {
  it('the production policy has no A7 value: policyDays refuses (OWNER_CHOICE_REQUIRED), the choice is listed as open', () => {
    expect(RETENTION_POLICY.durations.APPOINTMENT_CONFIRMED_DAYS).toMatchObject({ days: null, ownerChoice: 'A7', options: [365, 730] });
    expect('approvedChoices' in RETENTION_POLICY).toBe(false);
    expect(missingOwnerChoices(RETENTION_POLICY)).toEqual(['A7']);
    let err; try { policyDays(RETENTION_POLICY, 'APPOINTMENT_CONFIRMED_DAYS'); } catch (e) { err = e; }
    expect(err?.code).toBe(OWNER_CHOICE_REQUIRED);
    expect(policyDays(RETENTION_POLICY, 'APPOINTMENT_CONFIRMED_DAYS', { option: 365 })).toBe(365);
    expect(() => policyDays(RETENTION_POLICY, 'APPOINTMENT_CONFIRMED_DAYS', { option: 500 })).toThrow();
  });
  it('approved status + pinned version is NOT enough: missing choice, a value outside the options, or a version that does not name the choice → OWNER_CHOICE_MISSING', () => {
    const base = { ...RETENTION_POLICY, status: POLICY_STATUS_APPROVED, approvedPolicyVersion: RETENTION_POLICY.version };
    const env = { GDPR_PURGE_ENABLED: 'true', GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version, GDPR_PURGE_APPROVED_STEPS: 'deletedTokensCount' };
    expect(isPolicyApproved(base)).toBe(false);
    expect(executionGate(base, env).reason).toBe('OWNER_CHOICE_MISSING');
    expect(executionGate({ ...base, approvedChoices: { A7: 500 } }, env).reason).toBe('OWNER_CHOICE_MISSING');
    expect(executionGate({ ...base, approvedChoices: { A7: 365 } }, env).reason).toBe('OWNER_CHOICE_MISSING');   // version does not say a7-365d
    const v = `${RETENTION_POLICY.version}-${choiceTag('A7', 365)}`;
    const named = { ...base, version: v, approvedPolicyVersion: v, approvedChoices: { A7: 365 } };
    expect(isPolicyApproved(named)).toBe(true);
    expect(executionGate(named, { ...env, GDPR_PURGE_POLICY_VERSION: v })).toMatchObject({ execute: true });
    expect(isPolicyApproved({ ...named, approvedChoices: { A7: 730 } })).toBe(false);   // the tag names 365: changing the choice needs a new version
  });
  it('the production policy dry run counts the A7 steps once per option and never gives them a single « days »', async () => {
    const db = recDb();
    const { body } = await runGdprPurge({ database: db, env: { GDPR_PURGE_ENABLED: 'true' }, now: NOW, logger: log });
    expect(body.reason).toBe('POLICY_NOT_APPROVED');
    expect(body.owner_choice_required_steps).toEqual(A7_STEPS);
    for (const id of A7_STEPS) expect(body.steps.find((l) => l.id === id)).toMatchObject({ decision: 'owner_choice_required', days: null, count: null, countsByOption: { 365: 3, 730: 3 }, ownerChoice: { id: 'A7', made: false } });
    expect(body.policy.ownerChoicesOpen).toEqual(['A7']);
    // a dependent step says that its dry-run count is taken before the anonymisation steps run (execution removes more)
    expect(body.steps.find((l) => l.id === 'appointmentNoticesDeleted').countedBeforeDependencies).toEqual(['anonymisedAppointmentsCount', 'appointmentsUnconfirmedAnonymised', 'appointmentsCancelledAnonymised']);
    expect(writes(db)).toEqual([]);
  });
  it('each option gives its own cutoff (365 days is one year later than 730 for the same NOW)', async () => {
    const counted = async (a7) => {
      const db = recDb();
      await runGdprPurge({ database: db, policy: approvedTestPolicy({ a7 }), env: approvalEnv([], { a7 }), now: NOW, logger: log, dryRunRequested: true });
      const sel = db.calls.find((c) => c.op === 'select' && c.table === 'ProAppointment' && /NOT IN \('refused'/.test(dialect.sqlToQuery(c.where).sql));
      return dialect.sqlToQuery(sel.where).params.find((p) => p instanceof Date || /T\d\d:/.test(String(p)));
    };
    const c365 = new Date(await counted(365)); const c730 = new Date(await counted(730));
    expect(Math.round((c365.getTime() - c730.getTime()) / 86_400_000)).toBe(365);
  });
});

describe('per-step approval recorded in the policy (D4: dry run read, backup verified, written agreement)', () => {
  const step = { id: 'deletedTokensCount' };
  const shared = PURGE_STEPS.find((s) => s.id === 'rdvConversationsDeleted');
  it('stepApprovalProblem names what is missing', () => {
    const p = (rec) => ({ approvedSteps: { deletedTokensCount: rec, rdvConversationsDeleted: rec } });
    expect(stepApprovalProblem({}, step)).toBe('STEP_NOT_APPROVED_IN_POLICY');
    expect(stepApprovalProblem(p({ dryRunReviewedOn: '2026-11-05', backupVerified: 'b-1' }), step)).toBe('STEP_APPROVAL_DATE_MISSING');
    expect(stepApprovalProblem(p({ approvedOn: '2026-11-05', backupVerified: 'b-1' }), step)).toBe('STEP_DRY_RUN_REVIEW_MISSING');
    expect(stepApprovalProblem(p({ approvedOn: '2026-11-04', dryRunReviewedOn: '2026-11-05', backupVerified: 'b-1' }), step)).toBe('STEP_DRY_RUN_REVIEW_AFTER_APPROVAL');
    expect(stepApprovalProblem(p({ approvedOn: '2026-11-05', dryRunReviewedOn: '2026-11-05' }), step)).toBe('STEP_BACKUP_VERIFICATION_MISSING');
    expect(stepApprovalProblem(p({ approvedOn: '2026-11-05', dryRunReviewedOn: '2026-11-05', backupVerified: 'b-1' }), step)).toBeNull();
    expect(stepApprovalProblem(p({ approvedOn: '2026-11-05', dryRunReviewedOn: '2026-11-05', backupVerified: 'b-1' }), shared)).toBe('STEP_SHARED_CONTROLLER_BASIS_MISSING');
    expect(stepApprovalProblem(p(TEST_STEP_APPROVAL), shared)).toBeNull();
  });
  it('a step listed in GDPR_PURGE_APPROVED_STEPS but not approved in the policy is counted, never executed', async () => {
    const db = recDb();
    const { status, body } = await runGdprPurge({ database: db, policy: approvedTestPolicy({ steps: ['deletedEmailChangeCount'] }), env: approvalEnv(['deletedTokensCount', 'deletedEmailChangeCount']), now: NOW, logger: log });
    expect(status).toBe(200);
    expect(writes(db).map((c) => `${c.op}:${c.table}`)).toEqual(['delete:EmailChangeRequest', 'insert:AuditLog']);
    expect(body.step_approval_missing).toEqual([{ id: 'deletedTokensCount', reason: 'STEP_NOT_APPROVED_IN_POLICY' }]);
    expect(body.steps.find((l) => l.id === 'deletedTokensCount')).toMatchObject({ decision: 'not_approved_in_policy', count: 3 });
    expect(writes(db)[1].values.details.stepApprovalMissing).toEqual(['deletedTokensCount']);
  });
  it('the policy record alone executes nothing either (the operator list is still required)', async () => {
    const db = recDb();
    const { body } = await runGdprPurge({ database: db, policy: approvedTestPolicy({ steps: ['deletedTokensCount'] }), env: approvalEnv(['deletedEmailChangeCount']), now: NOW, logger: log });
    expect(writes(db).some((c) => c.table === 'AuthToken')).toBe(false);
    expect(body.not_approved_steps).toContain('deletedTokensCount');
  });
  it('the four-condition gate is unchanged: no execution without GDPR_PURGE_ENABLED, an approved version, the pin, a listed step', () => {
    const p = approvedTestPolicy();
    const env = approvalEnv(['deletedTokensCount']);
    expect(executionGate(p, { ...env, GDPR_PURGE_ENABLED: '' }).reason).toBe('GDPR_PURGE_DISABLED');
    expect(executionGate(RETENTION_POLICY, { ...env, GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version }).reason).toBe('POLICY_NOT_APPROVED');
    expect(executionGate(p, { ...env, GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version }).reason).toBe('POLICY_VERSION_NOT_PINNED');
    expect(executionGate(p, { ...env, GDPR_PURGE_APPROVED_STEPS: '' }).reason).toBe('NO_APPROVED_STEPS');
    expect(executionGate(p, env).execute).toBe(true);
    expect(testPolicyVersion(730)).toMatch(/a7-730d$/);
  });
});

describe('cascades onto records of another controller (structures)', () => {
  it('a shared copy with a SharedDossierThread is a followed copy: never deleted by step 5, redacted by 5b', () => {
    const q = dialect.sqlToQuery(hasFollowUpSql(/** @type {any} */ ({ getSQL: () => ({ queryChunks: [] }) })));
    expect(q.sql).toMatch(/"SharedDossierThread" st WHERE st\."sharedDiagnosticId"/);
    for (const id of ['deletedDiagnosticsCount', 'diagnosticsRedactedWithFollowUp']) expect(PURGE_STEPS.find((s) => s.id === id).tables).toContain('SharedDossierThread');
  });
  it('every step whose deletion cascades onto structure records is flagged shared-controller', () => {
    const flagged = PURGE_STEPS.filter((s) => s.sharedController).map((s) => s.id);
    expect(flagged).toEqual(['diagnosticsRedactedWithFollowUp', 'appointmentsStructureRecordAnonymised', 'rdvConversationsDeleted', 'disabledProUsersReport']);
  });
  it('no step deletes or anonymises a citizen ACCOUNT — except a NEVER-ACTIVATED one (V2 / D6: address never confirmed, 7 days)', () => {
    expect(PURGE_STEPS.filter((s) => s.table === 'CitizenUser').map((s) => [s.id, s.kind])).toEqual([['unverifiedAccountsDeleted', 'delete'], ['inactiveAccountsReport', 'report']]);
  });
});

describe('backup / erasure-replay interaction', () => {
  it('the erasure proofs (DSRRequest DELETE, and the consents of an erased person) outlive every backup and the longest proposed PITR window', () => {
    const backupDays = Math.max(policyDays(RETENTION_POLICY, 'BACKUP_KEEP_DAYS'), 35);   // D5 v2 proposes 35 days for the logical backups
    const pitrMax = 7;   // D5 v2: 1 day by default, 7 days at most
    expect(policyDays(RETENTION_POLICY, 'DSR_REQUEST_DAYS')).toBeGreaterThan(backupDays + pitrMax + policyDays(RETENTION_POLICY, 'BACKUP_KEEP_WEEKLY') * 7);
    expect(policyDays(RETENTION_POLICY, 'CONSENT_AFTER_ERASURE_DAYS')).toBeGreaterThan(backupDays + pitrMax + policyDays(RETENTION_POLICY, 'BACKUP_KEEP_WEEKLY') * 7);
    expect(PURGE_STEPS.find((s) => s.id === 'dsrRequestsDeleted').dependsOn).toEqual(['consentLogsAfterErasureDeleted']);
  });
  it('the replay script reinstates the open requests the purge protects (same statuses)', () => {
    expect([...OPEN_REQUEST_STATUSES]).toEqual([...OPEN_DSR_STATUSES]);
  });
  it('the legacy scripts/cron-purge.js no longer deletes or masks anything itself: it delegates to the gated engine', () => {
    const src = fs.readFileSync('scripts/cron-purge.js', 'utf8');
    expect(src).not.toMatch(/DELETE FROM|UPDATE "CitizenUser"|sql\.raw/);
    expect(src).toMatch(/runGdprPurge/);
    expect(src).not.toMatch(/RETENTION_USER_YEARS\b(?!.*no longer)/s);
  });
  it('every executable step still has an id the operator can list', () => {
    expect(executableStepIds(PURGE_STEPS).length).toBe(PURGE_STEPS.filter((s) => s.kind !== 'report').length);
  });
});
