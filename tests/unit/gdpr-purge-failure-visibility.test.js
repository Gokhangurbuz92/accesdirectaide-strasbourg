import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A failing retention step must be VISIBLE (logged, Sentry, in the response, non-200) — it used to be swallowed silently.
// R44: the purge executes only with an approved policy and approved steps (tests/helpers/gdpr-purge-approval.js); every step runs in its own transaction
// (here: the same mock), dry-run counts use select(); the assertions are unchanged.
const m = vi.hoisted(() => ({ deleteCalls: 0, failOn: 3, sentry: vi.fn(), errors: [] }));
vi.mock('@sentry/node', () => ({ captureException: m.sentry, default: { captureException: m.sentry } }));
vi.mock('../../api/_utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: (...a) => m.errors.push(a), debug: vi.fn() } }));
vi.mock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: () => ({ ok: true }) }));
vi.mock('../../src/db/index.js', () => {
  // R44: every table of the schema exists (a full LAB database) — the rows of information_schema.tables; the first row also answers the advisory lock
  const TABLES = ['EntityVersion', 'UpdateLog', 'AuditLog', 'ConversationLog', 'SharedDiagnostic', 'AuthToken', 'EmailChangeRequest', 'AiMetric', 'ConsentLog', 'UserConsent',
    'Invitation', 'ProOutlookToken', 'ProAuditLog', 'ProAppointment', 'AppointmentNotice', 'RdvConversation', 'RdvMessageAttachment', 'ProNotification', 'PushSubscription',
    'LegalHold', 'SupportRequest', 'DSRRequest', 'CitizenUser', 'ProUser', 'ProCase', 'Referral'];
  const GUEST = ['guestEmail', 'guestEmailHash', 'guestPhone', 'guestMailConsentAt', 'guestHoldExpiresAt', 'guestCodeHash', 'guestCodeAttempts',
    'guestConfirmedAt', 'guestManageTokenHash', 'guestManageExpiresAt', 'guestReminderConsentAt'];
  const chain = () => { const c = { from: () => c, where: () => c, innerJoin: () => c, for: async () => [], then: (resolve) => resolve([]) }; return c; };
  const db = {
    // DTA S8: a drizzle delete().where() is awaitable (node-postgres result with rowCount) AND exposes .returning() (rows). The shared-dossier step now uses .returning() to learn the
    // storage keys of the documents it must erase; both shapes count as ONE delete call, and the assertions below are unchanged.
    delete: () => {
      const step = () => { m.deleteCalls += 1; if (m.deleteCalls === m.failOn) throw new Error('boom'); return { rowCount: 2 }; };
      return {
        where: () => ({
          then: (resolve, reject) => Promise.resolve().then(step).then(resolve, reject),
          returning: async () => { step(); return [{ id: 'a', results: {} }, { id: 'b', results: {} }]; },
        }),
      };
    },
    update: () => ({ set: () => ({ where: async () => ({ rowCount: 1 }) }) }),
    select: () => chain(),
    insert: () => ({ values: async () => ({ rowCount: 1 }) }),
    // R40: the run holds an advisory lock in a transaction and reads which guest columns exist (here: all of them, migration 0044); R44: and which tables
    execute: async () => ({ rows: [...GUEST.map((column_name) => ({ ok: true, column_name })), ...TABLES.map((table_name) => ({ table_name }))] }),
  };
  db.transaction = async (fn) => fn(db);
  return { db };
});

import { createGdprPurgeHandler, PURGE_STEPS } from '../../api/_handlers/cron/gdpr-purge.js';
import { approvedTestPolicy, executableStepIds, setApprovalEnv } from '../helpers/gdpr-purge-approval.js';
const handler = createGdprPurgeHandler({ policy: approvedTestPolicy() });
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });

describe('gdpr-purge failure visibility and counts', () => {
  let restore = () => {};
  beforeEach(() => { m.deleteCalls = 0; m.failOn = 3; m.sentry.mockClear(); m.errors.length = 0; restore = setApprovalEnv(executableStepIds(PURGE_STEPS)); });   // R33 + R44: the purge runs only when enabled and approved
  afterEach(() => { restore(); });

  it('a failing step => 500 partial_failure, named in failed_steps, logged and sent to Sentry; other steps still ran', async () => {
    const r = res(); await handler({ method: 'GET', query: {}, headers: {}, url: '/x' }, r);
    expect(r.statusCode).toBe(500);
    expect(r.body.status).toBe('partial_failure');
    expect(r.body.failed_steps).toEqual(['deletedAuditCount']);
    expect(m.sentry).toHaveBeenCalledTimes(1);
    expect(m.errors.some((a) => a[0]?.step === 'deletedAuditCount')).toBe(true);
    expect(r.body.tokens_deleted).toBe(2);              // later steps still executed
    expect(r.body.appointments_anonymised).toBe(1);
  });

  it('all steps fine => 200 success with numeric counts from rowCount (node-postgres) and from arrays (.returning)', async () => {
    m.failOn = -1;
    const r = res(); await handler({ method: 'GET', query: {}, headers: {}, url: '/x' }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe('success');
    expect(r.body.failed_steps).toBeUndefined();
    expect(r.body.versions_deleted).toBe(2);
  });
});
