import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    url: overrides.url || '/api/monitor/data-quality',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(overrides.headers || {}),
    },
    query: {},
    body: null,
    cookies: {},
  };
}

function createRes() {
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {Array<() => void>} */
  const finishListeners = [];

  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    on(event, listener) {
      if (event === 'finish' && typeof listener === 'function') finishListeners.push(listener);
      return this;
    },
    setHeader(key, value) {
      headers[String(key).toLowerCase()] = String(value);
    },
    getHeader(key) {
      return headers[String(key).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    writeHead(code, outHeaders = {}) {
      this.statusCode = code;
      for (const [key, value] of Object.entries(outHeaders)) {
        headers[String(key).toLowerCase()] = String(value);
      }
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      for (const listener of finishListeners) listener();
      return this;
    },
    send(payload) {
      this.body = payload;
      this.headersSent = true;
      for (const listener of finishListeners) listener();
      return this;
    },
    end(payload) {
      if (typeof payload !== 'undefined') this.body = payload;
      this.headersSent = true;
      for (const listener of finishListeners) listener();
      return this;
    },
  };
}

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string> }} options
 */
async function invokeApi(url, options = {}) {
  const req = createReq({
    method: options.method,
    url,
    headers: options.headers,
  });
  const res = createRes();
  await apiHandler(req, res);
  return res;
}

describe('P8-F monitor data-quality endpoint contract', () => {
  const originalTotalMax = process.env.MONITOR_DQ_OPEN_TOTAL_MAX;
  const originalP0Max = process.env.MONITOR_DQ_OPEN_P0_MAX;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.MONITOR_DQ_OPEN_TOTAL_MAX = '500';
    process.env.MONITOR_DQ_OPEN_P0_MAX = '25';
    await await db.delete(schema.ReviewQueueItem);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalTotalMax == null) delete process.env.MONITOR_DQ_OPEN_TOTAL_MAX;
    else process.env.MONITOR_DQ_OPEN_TOTAL_MAX = originalTotalMax;
    if (originalP0Max == null) delete process.env.MONITOR_DQ_OPEN_P0_MAX;
    else process.env.MONITOR_DQ_OPEN_P0_MAX = originalP0Max;
    await await db.delete(schema.ReviewQueueItem);
  });

  it('GET /api/monitor/data-quality returns 200 with safe metrics payload when under thresholds', async () => {
    await db.insert(schema.ReviewQueueItem).values({
        id: crypto.randomUUID(),
        entityType: 'aide',
        entityId: 'p8f-monitor-1',
        reason: 'P8F_MONITOR_BASELINE',
        severity: 'P2',
        status: 'open',
        updatedAt: new Date()
      });

    const res = await invokeApi('/api/monitor/data-quality');

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      metrics: {
        openTotal: expect.any(Number),
        openP0: expect.any(Number),
        openP1: expect.any(Number),
      },
      thresholds: {
        openTotalMax: 500,
        openP0Max: 25,
      },
    });
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('details');
  });

  it('returns 503 when thresholds are exceeded', async () => {
    process.env.MONITOR_DQ_OPEN_TOTAL_MAX = '1';
    process.env.MONITOR_DQ_OPEN_P0_MAX = '1';

    await db.insert(schema.ReviewQueueItem).values([
        {
          id: crypto.randomUUID(),
          entityType: 'aide',
          entityId: 'p8f-monitor-2',
          reason: 'P8F_MONITOR_OVER_1',
          severity: 'P0',
          status: 'open',
          updatedAt: new Date()
        },
        {
          id: crypto.randomUUID(),
          entityType: 'aide',
          entityId: 'p8f-monitor-3',
          reason: 'P8F_MONITOR_OVER_2',
          severity: 'P0',
          status: 'open',
          updatedAt: new Date()
        },
      ]);

    const res = await invokeApi('/api/monitor/data-quality');

    expect(res.statusCode).toBe(503);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: false,
      error: 'unavailable',
      requestId: expect.any(String),
      metrics: {
        openTotal: expect.any(Number),
        openP0: expect.any(Number),
        openP1: expect.any(Number),
      },
      thresholds: {
        openTotalMax: 1,
        openP0Max: 1,
      },
    });
  });

  it('returns 405 for non-GET methods', async () => {
    const res = await invokeApi('/api/monitor/data-quality', { method: 'POST' });

    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ error: 'Method not allowed' });
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('returns 503 with safe payload when DB lookup fails', async () => {
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('relation private_table does not exist');
    });

    const res = await invokeApi('/api/monitor/data-quality');

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'unavailable',
      requestId: expect.any(String),
      metrics: {
        openTotal: null,
        openP0: null,
        openP1: null,
      },
      thresholds: {
        openTotalMax: expect.any(Number),
        openP0Max: expect.any(Number),
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('private_table');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('message');
  });
});
