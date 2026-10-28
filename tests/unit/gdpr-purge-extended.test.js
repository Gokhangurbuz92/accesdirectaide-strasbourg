/**
 * GDPR Purge Handler — Extended Test Suite
 *
 * Tests: auth rejection, method validation, missing CRON_SECRET
 * Note: Success path tests are in api/_handlers/cron/gdpr-purge.test.js
 * which has a properly scoped mock setup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the handler with a fresh DB mock
const mocks = vi.hoisted(() => {
  const whereFn = vi.fn().mockResolvedValue([]);
  const deleteFn = vi.fn(() => ({ where: whereFn }));
  return { whereFn, deleteFn, db: { delete: deleteFn } };
});

vi.mock('../../../src/db/index.js', () => ({ db: mocks.db }));

import handler from '../../../api/_handlers/cron/gdpr-purge.js';

function mockRes() {
  return {
    statusCode: 200,
    getHeader: vi.fn(),
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
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

describe('GDPR Purge Handler — Auth & Validation', () => {
  const ORIGINAL = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.whereFn.mockResolvedValue([]);
    mocks.deleteFn.mockReturnValue({ where: mocks.whereFn });
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
  });

  it('rejects POST method with 405', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects PUT method with 405', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PUT' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects DELETE method with 405', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'DELETE' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects request with wrong secret (401)', async () => {
    const res = mockRes();
    await handler(mockReq({ query: { secret: 'wrong-secret' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects request with no auth at all (401)', async () => {
    const res = mockRes();
    await handler(mockReq({}), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-cron-secret': 'any' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'CRON_SECRET is not configured' }),
    );
  });
});
