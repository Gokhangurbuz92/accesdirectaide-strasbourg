import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const TABLES = ['EntityVersion', 'UpdateLog', 'AuditLog', 'ConversationLog', 'SharedDiagnostic', 'AuthToken', 'EmailChangeRequest', 'AiMetric', 'ConsentLog', 'UserConsent',
    'Invitation', 'ProOutlookToken', 'ProAuditLog', 'ProAppointment', 'AppointmentNotice', 'RdvConversation', 'RdvMessageAttachment', 'ProNotification', 'PushSubscription',
    'LegalHold', 'SupportRequest', 'DSRRequest', 'CitizenUser', 'ProUser', 'ProCase', 'Referral'];
  const whereMock = vi.fn();
  // DTA S9: like the real drizzle builder, where() is awaitable AND exposes .returning() (the shared-dossier step reads the storage keys of the rows it deletes). Assertions unchanged.
  const deleteMock = vi.fn(() => ({ where: (/** @type {any[]} */ ...a) => Object.assign(Promise.resolve(whereMock(...a)), { returning: async () => [] }) }));
  return {
    whereMock,
    db: (() => {
      const chain = () => { const c = { from: () => c, where: () => c, innerJoin: () => c, for: async () => [], then: (/** @type {any} */ r) => r([]) }; return c; };
      /** @type {Record<string, any>} */
      const db = {
        delete: deleteMock,
        // step 13 (anonymise old appointments) uses db.update(...).set(...).where(...); without this mock the step threw and
        // was silently swallowed, which the handler now reports as partial_failure.
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({ rowCount: 0 }) })) })),
        // R44: dry-run counts (select), the run's evidence row (insert)
        select: vi.fn(() => chain()),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue({ rowCount: 1 }) })),
        // R40: the run holds an advisory lock in a transaction and reads which guest columns exist (none here: a 0042 schema); R44: and which tables exist
        // (all of them; the first row also answers the lock)
        execute: vi.fn().mockResolvedValue({ rows: TABLES.map((table_name) => ({ ok: true, table_name })) }),
      };
      // R44: every step runs in its own transaction (the same mock here)
      db.transaction = vi.fn(async (/** @type {(tx: any) => unknown} */ fn) => fn(db));
      return db;
    })(),
  };
});

vi.mock('../../../src/db/index.js', () => ({ db: mocks.db }));

import { createGdprPurgeHandler, PURGE_STEPS } from './gdpr-purge.js';
import { approvedTestPolicy, executableStepIds, setApprovalEnv } from '../../../tests/helpers/gdpr-purge-approval.js';

// R44: what an EXECUTING purge does — a test copy of the policy marked approved, every step approved
const handler = createGdprPurgeHandler({ policy: approvedTestPolicy() });

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.getHeader = vi.fn();
  res.setHeader = vi.fn();
  res.set = vi.fn();
  res.writeHead = vi.fn();
  res.end = vi.fn();
  res.status = vi.fn().mockReturnThis();
  res.json = vi.fn().mockReturnThis();
  res.send = vi.fn().mockReturnThis();
  res.redirect = vi.fn().mockReturnThis();
  return res;
}

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    url: 'http://localhost/api/cron/gdpr-purge',
    headers: {},
    query: {},
    body: {},
    cookies: {},
    ...overrides,
  };
}

describe('Cron GDPR Purge Handler', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  let restoreEnv = () => {};
  beforeEach(() => {
    restoreEnv = setApprovalEnv(executableStepIds(PURGE_STEPS));   // R33 + R44: the purge runs only when explicitly enabled and approved
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it('should reject when CRON_SECRET is missing (no fallback secret)', async () => {
    delete process.env.CRON_SECRET;

    const req = mockReq({ method: 'GET', query: { key: 'dev-secret-key' }, headers: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should accept legacy ?key= when CRON_SECRET matches (backward compatible)', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';

    mocks.whereMock.mockResolvedValueOnce([{ id: 1 }]); // versions
    mocks.whereMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]); // update logs
    mocks.whereMock.mockResolvedValueOnce([]); // audit logs

    const req = mockReq({ method: 'GET', query: { key: 'test-cron-secret' }, headers: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        versions_deleted: 1,
        update_logs_deleted: 2,
      }),
    );
  });
});
