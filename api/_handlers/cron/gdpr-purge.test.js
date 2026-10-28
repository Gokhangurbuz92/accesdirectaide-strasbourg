import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const whereMock = vi.fn();
  // DTA S9: like the real drizzle builder, where() is awaitable AND exposes .returning() (the shared-dossier step reads the storage keys of the rows it deletes). Assertions unchanged.
  const deleteMock = vi.fn(() => ({ where: (/** @type {any[]} */ ...a) => Object.assign(Promise.resolve(whereMock(...a)), { returning: async () => [] }) }));
  return {
    whereMock,
    db: {
      delete: deleteMock,
      // step 13 (anonymise old appointments) uses db.update(...).set(...).where(...); without this mock the step threw and
      // was silently swallowed, which the handler now reports as partial_failure.
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({ rowCount: 0 }) })) })),
    },
  };
});

vi.mock('../../../src/db/index.js', () => ({ db: mocks.db }));

import handler from './gdpr-purge.js';

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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
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
