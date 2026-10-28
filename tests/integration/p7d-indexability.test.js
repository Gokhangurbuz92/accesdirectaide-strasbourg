import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import apiHandler from '../../api/index.js';

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

  const res = {
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

  return res;
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

describe('P7-D indexability policy', () => {
  it('robots.txt policy includes admin and api disallow rules', () => {
    const robotsPath = path.resolve(process.cwd(), 'public/robots.txt');
    const content = fs.readFileSync(robotsPath, 'utf8');

    expect(content).toContain('User-agent: *');
    expect(content).toContain('Allow: /');
    expect(content).toContain('Disallow: /admin');
    expect(content).toContain('Disallow: /api/');
    expect(content).toContain('Sitemap: https://www.accesdirectaide.fr/sitemap.xml');
  });

  it('applies x-robots-tag noindex to technical API endpoints, including unauthorized responses', async () => {
    const health = await invokeApi('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.getHeader('x-robots-tag')).toBe('noindex, nofollow');

    const healthDeepUnauthorized = await invokeApi('/api/health/deep');
    expect(healthDeepUnauthorized.statusCode).toBe(401);
    expect(healthDeepUnauthorized.getHeader('x-robots-tag')).toBe('noindex, nofollow');

    const monitor = await invokeApi('/api/monitor/cron/actualites');
    expect([200, 503]).toContain(monitor.statusCode);
    expect(monitor.getHeader('x-robots-tag')).toBe('noindex, nofollow');

    const adminUnauthorized = await invokeApi('/api/admin/cron-runs');
    expect(adminUnauthorized.statusCode).toBe(401);
    expect(adminUnauthorized.getHeader('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('applies x-robots-tag noindex on cron unauthorized responses', async () => {
    const previousCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'p7d-test-secret';

    try {
      const cronUnauthorized = await invokeApi('/api/cron/actualites', {
        headers: {
          authorization: 'Bearer wrong-secret',
        },
      });

      expect(cronUnauthorized.statusCode).toBe(401);
      expect(cronUnauthorized.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    } finally {
      if (typeof previousCronSecret === 'undefined') {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousCronSecret;
      }
    }
  });
});

