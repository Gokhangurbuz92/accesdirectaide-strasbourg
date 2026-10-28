import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import monitorCoreHandler from '../../api/monitor/core.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { kv } from '../../api/_utils/kv.js';


/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, string>,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    url: overrides.url || '/api/monitor/core',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(overrides.headers || {}),
    },
    query: overrides.query || {},
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
      if (event === 'finish' && typeof listener === 'function') {
        finishListeners.push(listener);
      }
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
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, string>,
 * }} options
 */
async function invokeApi(url, options = {}) {
  const req = createReq({
    method: options.method,
    url,
    headers: options.headers,
    query: options.query,
  });
  const res = createRes();
  await monitorCoreHandler(req, res);
  return res;
}

describe('P8-B monitor core endpoint contract', () => {
  let originalKvSet;
  let originalKvGet;
  let originalKvDel;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalKvSet = kv.set;
    originalKvGet = kv.get;
    originalKvDel = kv.del;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    kv.set = originalKvSet;
    kv.get = originalKvGet;
    kv.del = originalKvDel;
  });

  it('GET /api/monitor/core returns 200 with minimal safe payload and technical headers', async () => {
    vi.spyOn(db, 'execute').mockResolvedValue([{ '?column?': 1 }]);
    kv.set = async () => 'OK';
    kv.get = async () => 'ok';
    kv.del = async () => 1;

    const res = await invokeApi('/api/monitor/core');

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('cache-control').toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      deps: {
        db: { ok: true, durationMs: expect.any(Number) },
        kv: { ok: true, durationMs: expect.any(Number) },
      },
    });
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('details');
  });

  it('returns 405 for non-GET methods', async () => {
    const res = await invokeApi('/api/monitor/core', { method: 'POST' });

    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ error: 'Method not allowed' });
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('returns 503 with safe generic error when DB probe fails', async () => {
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('relation private_table does not exist'));
    kv.set = async () => 'OK';
    kv.get = async () => 'ok';
    kv.del = async () => 1;

    const res = await invokeApi('/api/monitor/core');

    expect(res.statusCode).toBe(503);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: false,
      error: 'database_unavailable',
      requestId: expect.any(String),
      deps: {
        db: { ok: false, durationMs: expect.any(Number) },
        kv: { ok: true, durationMs: expect.any(Number) },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('private_table');
    expect(res.body).not.toHaveProperty('message');
    expect(res.body).not.toHaveProperty('stack');
  });
});
