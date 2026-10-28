import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach } from 'vitest';

// Mock the Drizzle db module
const mockFindMany = vi.fn();
vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      Aide: { findMany: (...args) => mockFindMany('Aide', ...args) },
      Demarche: { findMany: (...args) => mockFindMany('Demarche', ...args) },
      Structure: { findMany: (...args) => mockFindMany('Structure', ...args) },
      Dispositif: { findMany: (...args) => mockFindMany('Dispositif', ...args) },
    },
  },
}));

vi.mock('../src/db/schema.js', () => {
  const col = (name) => ({ name });
  return {
    Aide: { statut: col('statut'), slug: col('slug'), updatedAt: col('updatedAt') },
    Demarche: { statut: col('statut'), slug: col('slug'), updatedAt: col('updatedAt') },
    Structure: { statut: col('statut'), slug: col('slug'), updatedAt: col('updatedAt') },
    Dispositif: { statut: col('statut'), slug: col('slug'), updatedAt: col('updatedAt') },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNotNull: vi.fn(),
  desc: vi.fn(),
}));

// PKG-1 / D-5: the sitemap goes through the central publication contract (api/lib/publicVisibility.js); the real rule is tested in tests/unit/pkg1-public-visibility.test.js and on PostgreSQL.
const mockVisibleWhere = vi.fn((table, kind) => ({ visible: kind }));
vi.mock('../api/lib/publicVisibility.js', () => ({ visibleWhere: (...args) => mockVisibleWhere(...args) }));

import sitemapHandler from '../api/_handlers/sitemap.js';

function createReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'preview-accesdirectaide.vercel.app',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'preview-accesdirectaide.vercel.app',
    },
    ...overrides,
  };
}

function createRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

describe('Sitemap handler (P7-A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  it('returns XML with static and dynamic URLs', async () => {
    mockFindMany.mockImplementation((model) => {
      if (model === 'Aide') {
        return Promise.resolve([
          { slug: 'aide-exemple', updatedAt: new Date('2026-01-01T12:00:00.000Z') },
        ]);
      }
      return Promise.resolve([]);
    });

    const req = createReq();
    const res = createRes();

    await sitemapHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'application/xml; charset=utf-8',
      }),
    );

    const xml = res.end.mock.calls[0]?.[0];
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://preview-accesdirectaide.vercel.app/</loc>');
    expect(xml).toContain('<loc>https://preview-accesdirectaide.vercel.app/aides</loc>');
    expect(xml).toContain('<loc>https://preview-accesdirectaide.vercel.app/aides/aide-exemple</loc>');
  });

  it('PKG-1 / D-5 (P22: dispositifs too): each kind is filtered by the publication contract for its own kind', async () => {
    await sitemapHandler(createReq(), createRes());
    expect(mockVisibleWhere.mock.calls.map((c) => c[1]).sort()).toEqual(['aide', 'demarche', 'dispositif', 'structure']);
    const wheres = mockFindMany.mock.calls.map((c) => c[1].where);
    expect(wheres).toHaveLength(4);
  });

  it('returns 503 without stack details when DB is unavailable', async () => {
    mockFindMany.mockRejectedValue(new Error('db unavailable'));

    const req = createReq();
    const res = createRes();

    await sitemapHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      503,
      expect.objectContaining({
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
      }),
    );

    const body = res.end.mock.calls[0]?.[0];
    expect(body).toContain('<error>service_unavailable</error>');
    expect(body).not.toContain('db unavailable');
    expect(body).not.toContain('stack');
  });

  it('supports HEAD requests', async () => {
    const req = createReq({ method: 'HEAD' });
    const res = createRes();

    await sitemapHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith();
  });
});
