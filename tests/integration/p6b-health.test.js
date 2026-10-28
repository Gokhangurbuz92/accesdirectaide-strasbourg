import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

vi.mock('@vercel/kv', () => {
  const mockKv = {
    get: vi.fn().mockResolvedValue('ok'),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
  };
  return {
    __esModule: true,
    createClient: vi.fn(() => mockKv),
    kv: mockKv,
    default: mockKv,
  };
});

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import health from '../../api/_handlers/health.js';
import healthDeep from '../../api/_handlers/health-deep.js';

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/health',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
    },
    query: {},
    requestId: 'test-request-id',
    ...overrides,
  };
}

function mockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(key, value) {
      headers[String(key).toLowerCase()] = value;
    },
    getHeader(key) {
      return headers[String(key).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

describe('P6-B+ Health endpoints', () => {
  const ORIGINAL_STALE = process.env.CRON_ACTUALITES_STALE_MINUTES;
  const ORIGINAL_FAIL = process.env.CRON_ACTUALITES_FAIL_MINUTES;

  const ORIGINAL_STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT;
  const ORIGINAL_STORAGE_BUCKET = process.env.STORAGE_BUCKET;
  const ORIGINAL_STORAGE_ACCESS_KEY_ID = process.env.STORAGE_ACCESS_KEY_ID;
  const ORIGINAL_STORAGE_SECRET_ACCESS_KEY = process.env.STORAGE_SECRET_ACCESS_KEY;

  beforeEach(async () => {
    delete process.env.CRON_ACTUALITES_STALE_MINUTES;
    delete process.env.CRON_ACTUALITES_FAIL_MINUTES;
    // Prevent checkStorage() from attempting real S3 connections
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_BUCKET;
    delete process.env.STORAGE_ACCESS_KEY_ID;
    delete process.env.STORAGE_SECRET_ACCESS_KEY;
    await db.delete(schema.CronRun);
  });

  afterEach(async () => {
    process.env.CRON_ACTUALITES_STALE_MINUTES = ORIGINAL_STALE;
    process.env.CRON_ACTUALITES_FAIL_MINUTES = ORIGINAL_FAIL;
    process.env.STORAGE_ENDPOINT = ORIGINAL_STORAGE_ENDPOINT;
    process.env.STORAGE_BUCKET = ORIGINAL_STORAGE_BUCKET;
    process.env.STORAGE_ACCESS_KEY_ID = ORIGINAL_STORAGE_ACCESS_KEY_ID;
    process.env.STORAGE_SECRET_ACCESS_KEY = ORIGINAL_STORAGE_SECRET_ACCESS_KEY;
    await db.delete(schema.CronRun);
  });

  it('GET /api/health returns minimal ok payload + x-request-id', async () => {
    const req = mockReq({ url: '/api/health', requestId: 'req-123' });
    const res = mockRes();

    await health(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('x-request-id')).toBe('req-123');
    expect(res.body).toMatchObject({
      ok: true,
      service: expect.any(String),
      time: expect.any(String),
      requestId: 'req-123',
    });
  });

  it('GET /api/health/deep returns 401 when unauthorized', async () => {
    const req = mockReq({ url: '/api/health/deep', requestId: 'req-401' });
    const res = mockRes();

    await healthDeep(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: 'Unauthorized', requestId: 'req-401' });
  });

  it('GET /api/health/deep returns 200 when authorized', async () => {
    const req = mockReq({
      url: '/api/health/deep',
      requestId: 'req-200',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
      },
    });
    const res = mockRes();

    await healthDeep(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.deps?.db?.ok).toBe(true);
    expect(res.body?.deps?.cron?.actualites?.state).toBe('missing');
  });

  it('GET /api/health/deep reports cron freshness when latest success is recent', async () => {
    await (await db.insert(schema.CronRun).values({
        job: 'actualites',
        status: 'success',
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 20,
      },
    ).returning())[0];

    const req = mockReq({
      url: '/api/health/deep',
      requestId: 'req-fresh',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
      },
    });
    const res = mockRes();

    await healthDeep(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.deps?.cron?.actualites?.state).toBe('fresh');
    expect(res.body?.deps?.cron?.actualites?.ok).toBe(true);
  });

  it('GET /api/health/deep returns 200 with stale cron state before fail threshold', async () => {
    process.env.CRON_ACTUALITES_STALE_MINUTES = '1';
    process.env.CRON_ACTUALITES_FAIL_MINUTES = '999';

    await (await db.insert(schema.CronRun).values({
        job: 'actualites',
        status: 'success',
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
        finishedAt: new Date(Date.now() - 5 * 60 * 1000),
        durationMs: 20,
      },
    ).returning())[0];

    const req = mockReq({
      url: '/api/health/deep',
      requestId: 'req-stale',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
      },
    });
    const res = mockRes();

    await healthDeep(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.deps?.cron?.actualites?.state).toBe('stale');
    expect(res.body?.deps?.cron?.actualites?.ok).toBe(false);
  });

  it('GET /api/health/deep returns 503 when cron freshness exceeds fail threshold', async () => {
    process.env.CRON_ACTUALITES_STALE_MINUTES = '1';
    process.env.CRON_ACTUALITES_FAIL_MINUTES = '2';

    await (await db.insert(schema.CronRun).values({
        job: 'actualites',
        status: 'success',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        finishedAt: new Date(Date.now() - 10 * 60 * 1000),
        durationMs: 20,
      },
    ).returning())[0];

    const req = mockReq({
      url: '/api/health/deep',
      requestId: 'req-fail-threshold',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
      },
    });
    const res = mockRes();

    await healthDeep(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body?.ok).toBe(false);
    expect(res.body?.deps?.cron?.actualites?.state).toBe('error');
  });

  it('GET /api/health/deep returns 503 when db check fails', async () => {
    const dbSpy = vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('db down'));

    try {
      const req = mockReq({
        url: '/api/health/deep',
        requestId: 'req-503',
        headers: {
          host: 'localhost:3000',
          'x-forwarded-proto': 'http',
          authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
        },
      });
      const res = mockRes();

      await healthDeep(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body?.ok).toBe(false);
      expect(res.body?.deps?.db?.ok).toBe(false);
    } finally {
      dbSpy.mockRestore();
    }
  });
});
