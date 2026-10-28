import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

vi.stubEnv('KV_REST_API_URL', 'mock-url');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/admin/cron-runs',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
    },
    query: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader() {},
    end() {
      return this;
    },
  };
  return res;
}

describe('P6-B+ Admin cron-runs API', () => {
  /** @type {string[]} */
  const createdIds = [];

  beforeEach(() => {
    createdIds.length = 0;
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await await db.delete(schema.CronRun);
    }
  });

  it('returns 401 without admin token', async () => {
    const { default: handler } = await import('../../api/_handlers/admin/cron-runs.js');
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('lists recent cron runs when authorized', async () => {
    const run = await (await db.insert(schema.CronRun).values({
        id: crypto.randomUUID(),
        job: 'actualites',
        status: 'success',
        trigger: 'manual',
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 10,
        metrics: { fetched: 1 },
        updatedAt: new Date(),
      }).returning({ id: schema.CronRun.id }))[0];
    createdIds.push(run.id);

    const { default: handler } = await import('../../api/_handlers/admin/cron-runs.js');
    const req = mockReq({
      url: '/api/admin/cron-runs?job=actualites&limit=10',
      query: { job: 'actualites', limit: '10' },
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body?.items)).toBe(true);
    const item = res.body.items.find((entry) => entry.id === run.id);
    expect(item).toBeTruthy();
    expect(item.trigger).toBe('manual');
  });

  it('returns a cron run detail when authorized', async () => {
    const run = await (await db.insert(schema.CronRun).values({
        id: crypto.randomUUID(),
        job: 'actualites',
        status: 'skipped',
        trigger: 'external',
        skipReason: 'locked',
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 10,
        errorSample: 'boom',
        updatedAt: new Date(),
      }).returning({ id: schema.CronRun.id }))[0];
    createdIds.push(run.id);

    const { default: handler } = await import('../../api/_handlers/admin/cron-runs.js');
    const req = mockReq({
      url: `/api/admin/cron-runs/${run.id}`,
      headers: {
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.item?.id).toBe(run.id);
    expect(res.body?.item?.status).toBe('skipped');
    expect(res.body?.item?.skipReason).toBe('locked');
  });
});
