import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  kv: {
    set: vi.fn().mockResolvedValue('OK'),
  },
  withLock: vi.fn(async (_name, fn) => await fn()),
  runIngestActualitesRss: vi.fn().mockResolvedValue({
    fetched: 1,
    processed: 1,
    created: 1,
    updated: 0,
    skippedExisting: 0,
    errors: [],
    durationByStage: { fetchMs: 1, processingMs: 1 },
  }),
  dbValues: vi.fn(() => ({
    returning: vi.fn().mockResolvedValue([{ id: 'cron-run-id' }])
  })),
  dbSet: vi.fn(() => ({
    where: vi.fn().mockResolvedValue([{ id: 'cron-run-id' }])
  })),
  db: {
    query: {
      CronRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  },
}));

const insertMock = vi.fn(() => ({ values: mocks.dbValues }));
const updateMock = vi.fn(() => ({ set: mocks.dbSet }));
const typedDb = /** @type {typeof mocks.db & { insert: typeof insertMock; update: typeof updateMock }} */ (mocks.db);
typedDb.insert = insertMock;
typedDb.update = updateMock;

vi.mock('../../_utils/pipelineLock.js', () => ({
  withLock: mocks.withLock,
}));

vi.mock('../../_utils/kv.js', () => ({
  kv: mocks.kv,
}));

vi.mock('./ingest-actualites-rss.js', () => ({
  runIngestActualitesRss: mocks.runIngestActualitesRss,
}));

vi.mock('../../../src/db/index.js', () => ({
  db: mocks.db,
}));

import handler from './actualites.js';

/** @param {Record<string, unknown> & { headers?: Record<string, string> }} overrides */
function mockReq(overrides = {}) {
  const { headers: overrideHeaders = {}, ...rest } = overrides;
  const headers = {
    host: 'localhost:3000',
    'x-forwarded-proto': 'http',
    'user-agent': 'curl/8.0.0',
    ...overrideHeaders,
  };

  return {
    method: 'GET',
    url: 'http://localhost/api/cron/actualites',
    headers,
    query: {},
    body: {},
    cookies: {},
    ...rest,
  };
}

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

describe('Cron Actualites Handler', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
  const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.VERCEL_ENV = 'development';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  it('returns 500 when CRON_SECRET is missing (fail closed)', async () => {
    delete process.env.CRON_SECRET;

    const req = mockReq({
      headers: { 'x-cron-secret': 'test-cron-secret' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 401 when unauthorized', async () => {
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(typedDb.insert).not.toHaveBeenCalled();
  });

  // launch-readiness item 36: a user-agent names the scheduler, it proves nothing (anyone can send it) — Vercel Cron itself sends `Authorization: Bearer <CRON_SECRET>`
  it('refuses the Vercel Cron user-agent without the secret, in production too', async () => {
    process.env.VERCEL_ENV = 'production';

    const req = mockReq({
      headers: { 'user-agent': 'vercel-cron/1.0' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.runIngestActualitesRss).not.toHaveBeenCalled();
  });

  it('rejects Vercel Cron user-agent outside production', async () => {
    process.env.VERCEL_ENV = 'preview';

    const req = mockReq({
      headers: { 'user-agent': 'vercel-cron/1.0' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 202 and records skipped run when lock is already held', async () => {
    mocks.kv.set.mockResolvedValueOnce(null);

    const res = mockRes();
    await handler(
      mockReq({
        headers: { 'x-cron-secret': 'test-cron-secret' },
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mocks.runIngestActualitesRss).not.toHaveBeenCalled();
    expect(typedDb.insert).toHaveBeenCalledTimes(1);
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'locked',
        trigger: 'manual',
      })
    );
  });

  it('returns 202 and records skipped run when cooldown is active', async () => {
    mocks.db.query.CronRun.findFirst.mockResolvedValueOnce({ startedAt: new Date() });

    const res = mockRes();
    await handler(
      mockReq({
        headers: { 'x-cron-secret': 'test-cron-secret' },
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mocks.runIngestActualitesRss).not.toHaveBeenCalled();
    expect(typedDb.insert).toHaveBeenCalledTimes(1);
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'cooldown',
        trigger: 'manual',
      })
    );
  });

  it('returns 200 when authorized and triggers ingestion', async () => {
    const req = mockReq({
      headers: { 'x-cron-secret': 'test-cron-secret' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mocks.dbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        trigger: 'manual',
      })
    );
    expect(typedDb.update).toHaveBeenCalled();
    expect(mocks.runIngestActualitesRss).toHaveBeenCalledWith(
      expect.objectContaining({ runId: expect.any(String) }),
    );
  });
});
