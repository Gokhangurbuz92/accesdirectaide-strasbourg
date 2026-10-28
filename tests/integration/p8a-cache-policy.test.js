import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';
import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

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
    url: overrides.url || '/api/health',
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
  await apiHandler(req, res);
  return res;
}

describe('P8-A cache policy contracts', () => {
  it('applies CDN cache headers on public content endpoints when response is 200', async () => {
    const aides = await invokeApi('/api/aides?limit=1&statut=publie');
    expect(aides.statusCode).toBe(200);
    expect(String(aides.getHeader('cache-control'))).toContain('s-maxage=3600');
    expect(String(aides.getHeader('cache-control'))).toContain('stale-while-revalidate=86400');

    const actualites = await invokeApi('/api/actualites?limit=1');
    expect(actualites.statusCode).toBe(200);
    expect(String(actualites.getHeader('cache-control'))).toContain('s-maxage=300');
    expect(String(actualites.getHeader('cache-control'))).toContain('stale-while-revalidate=21600');
  });

  it('forces no-store on technical endpoints', async () => {
    const health = await invokeApi('/api/health');
    expect(health.statusCode).toBe(200);
    expect(String(health.getHeader('cache-control')).toLowerCase()).toContain('no-store');
  });

  it('uses public cache for sitemap 200 and no-store for sitemap 503', async () => {
    const sitemapOk = await invokeApi('/api/sitemap.xml');
    expect(sitemapOk.statusCode).toBe(200);
    expect(String(sitemapOk.getHeader('cache-control'))).toContain('s-maxage=3600');
    expect(String(sitemapOk.getHeader('cache-control'))).toContain('stale-while-revalidate=86400');

    const originalFindMany = db.query.Aide.findMany;
    db.query.Aide.findMany = async () => {
      throw new Error('db unavailable');
    };

    try {
      const sitemapDown = await invokeApi('/api/sitemap.xml');
      expect(sitemapDown.statusCode).toBe(503);
      expect(String(sitemapDown.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    } finally {
      db.query.Aide.findMany = originalFindMany;
    }
  });
});
