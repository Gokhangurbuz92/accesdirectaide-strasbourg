import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';

vi.stubEnv('KV_REST_API_URL', 'mock-url');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
vi.mock('@vercel/kv', () => ({
  createClient: vi.fn(),
  kv: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
  }
}));

import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 *   body?: unknown,
 *   query?: Record<string, string>,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'POST',
    url: overrides.url || '/api/cron/review-queue/scan',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(overrides.headers || {}),
    },
    query: overrides.query || {},
    body: overrides.body || null,
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
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: unknown,
 *   query?: Record<string, string>,
 * }} options
 */
async function invokeApi(url, options = {}) {
  const req = createReq({
    method: options.method,
    url,
    headers: options.headers,
    body: options.body,
    query: options.query,
  });
  const res = createRes();
  await apiHandler(req, res);
  return res;
}

describe('P8-F cron review queue scan endpoint contract', () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalCronEnabled = process.env.DATA_REVIEW_SCAN_CRON_ENABLED;
  const originalCronLimit = process.env.DATA_REVIEW_SCAN_CRON_LIMIT_PER_TYPE;
  /** @type {string[]} */
  const createdAideIds = [];

  beforeEach(async () => {
    process.env.CRON_SECRET = 'p8f-cron-secret';
    process.env.DATA_REVIEW_SCAN_CRON_ENABLED = '1';
    process.env.DATA_REVIEW_SCAN_CRON_LIMIT_PER_TYPE = '10';
    await await db.delete(schema.ReviewQueueItem);
  });

  afterEach(async () => {
    if (originalCronSecret == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;

    if (originalCronEnabled == null) delete process.env.DATA_REVIEW_SCAN_CRON_ENABLED;
    else process.env.DATA_REVIEW_SCAN_CRON_ENABLED = originalCronEnabled;

    if (originalCronLimit == null) delete process.env.DATA_REVIEW_SCAN_CRON_LIMIT_PER_TYPE;
    else process.env.DATA_REVIEW_SCAN_CRON_LIMIT_PER_TYPE = originalCronLimit;

    await await db.delete(schema.ReviewQueueItem);
    if (createdAideIds.length > 0) {
      await await db.delete(schema.Aide);
      createdAideIds.length = 0;
    }
  });

  it('returns 401 when request is not authorized', async () => {
    const res = await invokeApi('/api/cron/review-queue/scan', { method: 'POST' });

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Unauthorized',
      requestId: expect.any(String),
    });
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('returns 200 with summary when authorized via Bearer cron secret', async () => {
    const aide = await (await db.insert(schema.Aide).values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        titre: 'P8F cron scan candidate',
        slug: `p8f-cron-scan-${Date.now()}`,
        statut: 'publie',
        est_urgent: false,
        territoires: ['national'],
        documents_necessaires: [],
        date_verification: null,
        source_url: null,
      }).returning({ id: schema.Aide.id }))[0];
    createdAideIds.push(aide.id);

    const res = await invokeApi('/api/cron/review-queue/scan', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ limitPerType: 5 }),
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      summary: {
        created: expect.any(Number),
        updated: expect.any(Number),
        openTotal: expect.any(Number),
        scanned: expect.any(Object),
        bySeverity: expect.any(Object),
        byReason: expect.any(Object),
        byEntityType: expect.any(Object),
      },
    });
    expect(res.body).not.toHaveProperty('stack');
  });

  it('returns 405 for unsupported methods', async () => {
    const res = await invokeApi('/api/cron/review-queue/scan', {
      method: 'PUT',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });

    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({
      error: 'Method not allowed',
      requestId: expect.any(String),
    });
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;

    const res = await invokeApi('/api/cron/review-queue/scan', { method: 'POST' });

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      error: 'CRON_SECRET is not configured',
      requestId: expect.any(String),
    });
  });
});
