import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

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
    url: overrides.url || '/api/monitor/ingestion-freshness',
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

describe('P8-F monitor ingestion freshness endpoint contract', () => {
  const originalThreshold = process.env.MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS;
  /** @type {typeof db.query.SourceDocument.findFirst} */
  let originalFindFirst;

  beforeEach(() => {
    process.env.MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS = '48';
    originalFindFirst = db.query.SourceDocument.findFirst;
  });

  afterEach(() => {
    db.query.SourceDocument.findFirst = originalFindFirst;
    if (originalThreshold == null) delete process.env.MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS;
    else process.env.MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS = originalThreshold;
  });

  it('returns 200 when latest SourceDocument is within threshold', async () => {
    db.query.SourceDocument.findFirst = async () => ({
      fetched_at: new Date(),
    });

    const res = await invokeApi('/api/monitor/ingestion-freshness');

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: true,
      state: 'fresh',
      requestId: expect.any(String),
      latestFetchedAt: expect.any(String),
      ageHours: expect.any(Number),
      thresholdHours: 48,
    });
  });

  it('returns 503 stale when latest fetch is older than threshold', async () => {
    process.env.MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS = '1';
    db.query.SourceDocument.findFirst = async () => ({
      fetched_at: new Date(Date.now() - 5 * 3600000),
    });

    const res = await invokeApi('/api/monitor/ingestion-freshness');

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      ok: false,
      state: 'stale',
      requestId: expect.any(String),
      latestFetchedAt: expect.any(String),
      ageHours: expect.any(Number),
      thresholdHours: 1,
      error: 'unavailable',
    });
  });

  it('returns 503 missing when no SourceDocument exists', async () => {
    db.query.SourceDocument.findFirst = async () => null;

    const res = await invokeApi('/api/monitor/ingestion-freshness');

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      ok: false,
      state: 'missing',
      requestId: expect.any(String),
      latestFetchedAt: null,
      ageHours: null,
      thresholdHours: expect.any(Number),
      error: 'unavailable',
    });
  });

  it('returns 405 for non-GET methods', async () => {
    const res = await invokeApi('/api/monitor/ingestion-freshness', { method: 'POST' });

    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ error: 'Method not allowed' });
  });

  it('returns 503 error with safe payload when DB check crashes', async () => {
    db.query.SourceDocument.findFirst = async () => {
      throw new Error('sensitive db internals');
    };

    const res = await invokeApi('/api/monitor/ingestion-freshness');

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      ok: false,
      state: 'error',
      requestId: expect.any(String),
      latestFetchedAt: null,
      ageHours: null,
      thresholdHours: expect.any(Number),
      error: 'unavailable',
    });
    expect(JSON.stringify(res.body)).not.toContain('sensitive db internals');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('message');
  });
});
