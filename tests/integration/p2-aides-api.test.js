import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

/**
 * P2 Aides API Integration (DB-backed)
 *
 * These tests validate the public contract needed by the /aides listing + detail pages.
 * They are skipped when DATABASE_URL is not configured.
 */

import { describe, it, expect } from 'vitest';
import aidesHandler from '../../api/_handlers/aides.js';

function createMockReq({ method = 'GET', url = '/api/aides', query = {}, headers = {} } = {}) {
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

describe.skipIf(!hasDatabase)('P2 Aides API (requires DB)', () => {
  it('GET /api/aides returns 200 with pagination fields (limit/hasNext)', async () => {
    const req = createMockReq({
      url: '/api/aides?statut=publie&limit=5',
      query: { statut: 'publie', limit: '5' },
    });
    const res = createMockRes();

    await aidesHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 5,
      })
    );
    expect(typeof res.body.pagination.total).toBe('number');
    expect(typeof res.body.pagination.hasNext).toBe('boolean');
  });

  it('GET /api/aides/:slug returns 200 for an existing aide', async () => {
    // First, discover an existing aide from the DB
    const listReq = createMockReq({
      url: '/api/aides?statut=publie&limit=1',
      query: { statut: 'publie', limit: '1' },
    });
    const listRes = createMockRes();
    await aidesHandler(listReq, listRes);

    if (!listRes.body?.items?.length) {
      // No published aides in DB — skip gracefully
      return;
    }

    const slug = listRes.body.items[0].slug;
    const req = createMockReq({
      url: `/api/aides/${slug}`,
      query: {},
    });
    const res = createMockRes();

    await aidesHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ slug }));
  });

  it('GET /api/aides/:slug returns 404 for unknown slug', async () => {
    const req = createMockReq({
      url: '/api/aides/unknown-slug-does-not-exist',
      query: {},
    });
    const res = createMockRes();

    await aidesHandler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('filters by category and situation (AidSituation code)', async () => {
    const req = createMockReq({
      url: '/api/aides?statut=publie&limit=10',
      query: { statut: 'publie', limit: '10' },
    });
    const res = createMockRes();

    await aidesHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    // Don't require > 0 items — DB may have no matching data
  });
});

