import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

/**
 * P5 Actualites API Integration (DB-backed)
 *
 * These tests validate the public contract needed by the /actualites listing + /actualites/:slug pages.
 * They are skipped when DATABASE_URL is not configured.
 */

import { describe, it, expect } from 'vitest';
import actualitesHandler from '../../api/_handlers/actualites.js';

function createMockReq({ method = 'GET', url = '/api/actualites', query = {}, headers = {} } = {}) {
  return {
    method,
    url,
    query,
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...headers,
    },
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    end(data) {
      if (data) this.body = data;
      return this;
    },
  };
  return res;
}

const hasDatabase = !!process.env.DATABASE_URL;

describe.skipIf(!hasDatabase)('P5 Actualites API (requires DB)', () => {
  it('GET /api/actualites returns 200 with pagination fields (limit/hasNext)', async () => {
    const req = createMockReq({
      url: '/api/actualites?limit=5',
      query: { limit: '5' },
    });
    const res = createMockRes();

    await actualitesHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 5,
      }),
    );
    expect(typeof res.body.pagination.total).toBe('number');
    expect(typeof res.body.pagination.hasNext).toBe('boolean');
  });

  it('GET /api/actualites/:slug returns 200 for an existing actualite', async () => {
    const listReq = createMockReq({
      url: '/api/actualites?limit=1',
      query: { limit: '1' },
    });
    const listRes = createMockRes();
    await actualitesHandler(listReq, listRes);

    if (!listRes.body?.items?.length) return;

    const slug = listRes.body.items[0].slug;
    const req = createMockReq({
      url: `/api/actualites/${slug}`,
      query: {},
    });
    const res = createMockRes();

    await actualitesHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ slug }));
  });

  it('GET /api/actualites/:slug returns 404 for unknown slug', async () => {
    const req = createMockReq({
      url: '/api/actualites/unknown-actualite-does-not-exist',
      query: {},
    });
    const res = createMockRes();

    await actualitesHandler(req, res);

    expect(res.statusCode).toBe(404);
  });
});

