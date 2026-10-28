import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, test, expect } from 'vitest';
import { db } from '../../src/db/index.js';
import sitemapHandler from '../../api/_handlers/sitemap.js';

const { mockAideFindMany, mockDemarcheFindMany, mockStructureFindMany } = vi.hoisted(() => ({
  mockAideFindMany: vi.fn(),
  mockDemarcheFindMany: vi.fn(),
  mockStructureFindMany: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    query: {
      Aide: { findMany: vi.fn() },
      Demarche: { findMany: vi.fn() },
      Structure: { findMany: vi.fn() },
      Dispositif: { findMany: vi.fn() }
    }
  }
}));

describe('URL Canonical Consistency', () => {
  test('Sitemap should generate plural /aides/:slug URLs', async () => {
    vi.clearAllMocks();
    db.query.Aide.findMany.mockResolvedValue([{ slug: 'test-aide-slug', updated_at: new Date() }]);
    db.query.Demarche.findMany.mockResolvedValue([{ slug: 'test-demarche-slug', updated_at: new Date() }]);
    db.query.Structure.findMany.mockResolvedValue([{ slug: 'test-structure-slug', updated_at: new Date() }]);
    db.query.Dispositif.findMany.mockResolvedValue([]);

    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const req = {
      method: 'GET',
      headers: {
        host: 'preview-accesdirectaide.vercel.app',
        'x-forwarded-proto': 'https',
      },
    };

    await sitemapHandler(req, res);

    expect(res.end).toHaveBeenCalled();
    const output = res.end.mock.calls[0][0];
    expect(output).toContain('<loc>https://preview-accesdirectaide.vercel.app/aides/test-aide-slug</loc>');
    expect(output).not.toContain('<loc>https://preview-accesdirectaide.vercel.app/aide/test-aide-slug</loc>');
    // Verify démarches and structures are also in sitemap
    expect(output).toContain('<loc>https://preview-accesdirectaide.vercel.app/demarches/test-demarche-slug</loc>');
    // P22: the canonical address of a place is /structures/<slug> (/annuaire/<slug> answers 301 to it)
    expect(output).toContain('<loc>https://preview-accesdirectaide.vercel.app/structures/test-structure-slug</loc>');
  });
});
