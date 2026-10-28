import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import monitorCronActualites from '../../api/_handlers/monitor/cron-actualites.js';

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/monitor/cron/actualites',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
    },
    query: {},
    requestId: 'monitor-test-request-id',
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
  };
  return res;
}

describe('P6-G monitor cron actualites endpoint', () => {
  const ORIGINAL_STALE = process.env.CRON_ACTUALITES_STALE_MINUTES;
  const ORIGINAL_FAIL = process.env.CRON_ACTUALITES_FAIL_MINUTES;

  beforeEach(async () => {
    vi.restoreAllMocks();
    delete process.env.CRON_ACTUALITES_STALE_MINUTES;
    delete process.env.CRON_ACTUALITES_FAIL_MINUTES;
    await db.delete(schema.CronRun);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.CRON_ACTUALITES_STALE_MINUTES = ORIGINAL_STALE;
    process.env.CRON_ACTUALITES_FAIL_MINUTES = ORIGINAL_FAIL;
    await db.delete(schema.CronRun);
  });

  it('returns 405 for non-GET methods', async () => {
    const req = mockReq({ method: 'POST' });
    const res = mockRes();

    await monitorCronActualites(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ error: 'Method not allowed' });
  });

  it('returns 200 with ok:false when no successful run exists', async () => {
    const req = mockReq({ requestId: 'monitor-missing' });
    const res = mockRes();

    await monitorCronActualites(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('cache-control')).toBe('no-store');
    expect(res.getHeader('x-request-id')).toBe('monitor-missing');
    expect(res.body).toMatchObject({
      ok: false,
      job: 'actualites',
      requestId: 'monitor-missing',
    });
  });

  it('returns 200 fresh when latest success is recent', async () => {
    await (await db.insert(schema.CronRun).values({
        job: 'actualites',
        status: 'success',
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 20,
      },
    ).returning())[0];

    const req = mockReq({ requestId: 'monitor-fresh' });
    const res = mockRes();

    await monitorCronActualites(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.state).toBe('fresh');
    expect(typeof res.body?.ageMinutes === 'number').toBe(true);
  });

  it('returns 200 with ok:false when age exceeds stale threshold', async () => {
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

    const req = mockReq({ requestId: 'monitor-stale' });
    const res = mockRes();

    await monitorCronActualites(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      state: 'stale',
      requestId: 'monitor-stale',
    });
  });

  it('returns 200 with ok:false when freshness lookup fails', async () => {
    vi.spyOn(db.query.CronRun, 'findFirst').mockRejectedValue(new Error('db unavailable'));

    try {
      const req = mockReq({ requestId: 'monitor-error' });
      const res = mockRes();

      await monitorCronActualites(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        ok: false,
        job: 'actualites',
        state: 'error',
        ageMinutes: null,
        lastSuccessAt: null,
        requestId: 'monitor-error',
      });
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('details');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

