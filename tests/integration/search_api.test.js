import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { beforeEach, describe, expect, it } from 'vitest';

// Mock rate limiter to always allow
vi.mock('../../api/_utils/rateLimit.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../api/lib/EmbeddingProvider.js', () => ({
  generateEmbedding: vi.fn(),
  getActiveEmbeddingModel: vi.fn().mockReturnValue('gemini-embedding-001'),
}));

vi.mock('../../api/lib/hybrid-search.js', () => ({
  searchAidesHybrid: vi.fn(),
}));

// Mock cachedSearch to bypass Redis and call the callback directly
vi.mock('../../api/lib/search-cache.js', () => ({
    cachedSearch: vi.fn(async (_key, cb) => ({ data: await cb(), cached: false })),
}));

// Mock DB queries for cross-entity search (demarches, structures, actualites)
vi.mock('../../src/db/index.js', () => ({
    db: {
        query: {
            Demarche: { findMany: vi.fn().mockResolvedValue([]) },
            Structure: { findMany: vi.fn().mockResolvedValue([]) },
            Actualite: { findMany: vi.fn().mockResolvedValue([]) },
        },
    },
}));

import handler from '../../api/_handlers/search.js';
import { generateEmbedding } from '../../api/lib/EmbeddingProvider.js';
import { searchAidesHybrid } from '../../api/lib/hybrid-search.js';

function createRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('POST /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 405 when method is not POST', async () => {
    const req = { method: 'GET', body: {} };
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when payload is invalid', async () => {
    const req = { method: 'POST', body: { query: 'x' } };
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid payload' }));
  });

  it('returns not found fallback when result set is weak/empty', async () => {
    const req = { method: 'POST', body: { query: 'loyer étudiant Strasbourg' } };
    const res = createRes();

    generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    searchAidesHybrid.mockResolvedValue({ items: [], total: 0, weakResult: true });

    await handler(req, res);

    expect(generateEmbedding).toHaveBeenCalledWith('loyer étudiant Strasbourg');
    expect(searchAidesHybrid).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'loyer étudiant Strasbourg',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      items: [],
      total: 0,
      message: 'not found',
      demarches: [],
      structures: [],
      actualites: [],
    }));
  });

  it('returns fused items when search is successful', async () => {
    const req = {
      method: 'POST',
      body: {
        query: 'loyer étudiant Strasbourg',
        category: 'LOGEMENT',
        situations: ['etudiant'],
      },
    };
    const res = createRes();

    generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    searchAidesHybrid.mockResolvedValue({
      weakResult: false,
      total: 1,
      items: [
        {
          slug: 'apl-etudiant-strasbourg',
          title: 'APL étudiant à Strasbourg',
          score: 0.42,
        },
      ],
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.items).toEqual([
      {
        slug: 'apl-etudiant-strasbourg',
        title: 'APL étudiant à Strasbourg',
        score: 0.42,
      },
    ]);
    expect(jsonCall.total).toBe(1);
    expect(jsonCall.message).toBeNull();
    expect(jsonCall).toHaveProperty('demarches');
    expect(jsonCall).toHaveProperty('structures');
    expect(jsonCall).toHaveProperty('actualites');
  });
});
