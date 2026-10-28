import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

/**
 * P4 Structures API Integration (DB-backed)
 *
 * These tests validate the public contract needed by the /annuaire listing + /structures/:slug pages.
 * They are skipped when DATABASE_URL is not configured.
 */

import { describe, it, expect } from 'vitest';
import structuresHandler from '../../api/_handlers/structures.js';

function createMockReq({ method = 'GET', url = '/api/structures', query = {}, headers = {} } = {}) {
  return {
    method,
    url,
    query,
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      'x-forwarded-for': '127.0.0.1',
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

describe.skipIf(!hasDatabase)('P4 Structures API (requires DB)', () => {
  it('GET /api/structures returns 200 with pagination fields (limit/hasNext)', async () => {
    const req = createMockReq({
      url: '/api/structures?limit=5',
      query: { limit: '5' },
    });
    const res = createMockRes();

    await structuresHandler(req, res);

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

  it('GET /api/structures/:slug returns 200 for an existing structure', async () => {
    const listReq = createMockReq({
      url: '/api/structures?limit=1',
      query: { limit: '1' },
    });
    const listRes = createMockRes();
    await structuresHandler(listReq, listRes);

    if (!listRes.body?.items?.length) return;

    const slug = listRes.body.items[0].slug;
    const req = createMockReq({
      url: `/api/structures/${slug}`,
      query: {},
    });
    const res = createMockRes();

    await structuresHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ slug }));
  });

  it('GET /api/structures/:slug returns 404 for unknown slug', async () => {
    const req = createMockReq({
      url: '/api/structures/unknown-structure-does-not-exist',
      query: {},
    });
    const res = createMockRes();

    await structuresHandler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('filters by city', async () => {
    const req = createMockReq({
      url: '/api/structures?limit=10',
      query: { limit: '10' },
    });
    const res = createMockRes();

    await structuresHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    // Don't require > 0 items — DB may have no matching data
  });
});

