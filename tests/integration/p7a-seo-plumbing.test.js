import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import sitemapHandler from '../../api/_handlers/sitemap.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

function createMockReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'preview-accesdirectaide.vercel.app',
      'x-forwarded-host': 'preview-accesdirectaide.vercel.app',
      'x-forwarded-proto': 'https',
    },
    ...overrides,
  };
}

function createMockRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    setHeader(key, value) {
      headers[String(key).toLowerCase()] = value;
    },
    getHeader(key) {
      return headers[String(key).toLowerCase()];
    },
    writeHead(code, outHeaders = {}) {
      this.statusCode = code;
      for (const [key, value] of Object.entries(outHeaders)) {
        headers[String(key).toLowerCase()] = value;
      }
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('P7-A SEO plumbing', () => {
  it('GET /robots.txt serves expected directives with sitemap', async () => {
    const robotsPath = path.resolve(process.cwd(), 'public/robots.txt');
    const robotsContent = fs.readFileSync(robotsPath, 'utf8');

    const server = http.createServer((req, res) => {
      if (req.url === '/robots.txt' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(robotsContent);
        return;
      }
      res.statusCode = 404;
      res.end('not_found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/robots.txt`);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toContain('User-agent: *');
      expect(text).toContain('Allow: /');
      expect(text).toContain('Sitemap: https://www.accesdirectaide.fr/sitemap.xml');
      expect(text).not.toMatch(/api\/admin|token|secret/i);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('GET /sitemap.xml returns valid XML and expected URLs', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await sitemapHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('application/xml; charset=utf-8');
    expect(String(res.body)).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(String(res.body)).toContain('<loc>https://preview-accesdirectaide.vercel.app/</loc>');
    expect(String(res.body)).toContain('<loc>https://preview-accesdirectaide.vercel.app/aides</loc>');
    // Dynamic aide slugs depend on DB content — validate XML structure only
  });

  it('GET /sitemap.xml returns 503 with minimal XML when DB is down', async () => {
    const originalFindMany = db.query.Aide.findMany;
    db.query.Aide.findMany = async () => {
      throw new Error('db is unavailable');
    };

    try {
      const req = createMockReq({ headers: { host: 'localhost:3000' } });
      const res = createMockRes();

      await sitemapHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.getHeader('content-type')).toBe('application/xml; charset=utf-8');
      expect(String(res.body)).toContain('<error>service_unavailable</error>');
      expect(String(res.body)).not.toContain('db is unavailable');
      expect(String(res.body)).not.toContain('stack');
    } finally {
      db.query.Aide.findMany = originalFindMany;
    }
  });
});

