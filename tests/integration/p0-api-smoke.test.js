import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

/**
 * P0 API Smoke Tests
 * 
 * These tests verify that critical API endpoints return 200 (not 500 or 400)
 * DB-dependent tests are skipped when SKIP_DB_SETUP is set (CI without real DB)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../api/_handlers/aides.js';
import demarchesHandler from '../../api/_handlers/demarches.js';
import structuresHandler from '../../api/_handlers/structures.js';
import actualitesHandler from '../../api/_handlers/actualites.js';
import sitemapHandler from '../../api/_handlers/sitemap.js';

// CI sets SKIP_DB_SETUP=true — no real DB available
const skipDbTests = !!process.env.SKIP_DB_SETUP;

// Mock request/response helpers
function createMockReq(method = 'GET', query = {}, headers = {}) {
  return {
    method,
    query,
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...headers
    },
    url: '/api/test?' + new URLSearchParams(query).toString()
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
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    end(data) {
      if (data) this.body = data;
      return this;
    }
  };
  return res;
}

describe('P0 API Smoke Tests', () => {

  describe('Sitemap', () => {
    it('should return 200 or 503 with valid XML', async () => {
      const req = createMockReq('GET', {});
      const res = createMockRes();

      await sitemapHandler(req, res);

      // 200 when DB is available, 503 when not (graceful degradation)
      expect([200, 503]).toContain(res.statusCode);
      expect(res.headers['Content-Type']).toContain('xml');
      expect(res.body).toContain('<?xml');
    });
  });

  describe('Actualites API', () => {
    it('should return 200 for basic query (with fallback)', async () => {
      const req = createMockReq('GET', { 
        statut: 'publie',
        sort: '-date_publication',
        limit: '3'
      });
      const res = createMockRes();
      
      await actualitesHandler(req, res);
      
      // Should return 200 even if DB is not available (fallback)
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe.skipIf(skipDbTests)('Aides API (requires DB)', () => {
    it('should return 200 for basic query', async () => {
      const req = createMockReq('GET', { 
        statut: 'publie',
        limit: '3'
      });
      const res = createMockRes();
      
      await handler(req, res);
      
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('pagination');
    });

    it('should NOT return 400 for sort=-created_date', async () => {
      const req = createMockReq('GET', { 
        statut: 'publie',
        sort: '-created_date',
        limit: '12'
      });
      const res = createMockRes();
      
      await handler(req, res);
      
      // This is the critical P0 fix - should NOT be 400
      expect(res.statusCode).not.toBe(400);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
    });

    it('should accept sort=-published_at', async () => {
      const req = createMockReq('GET', { 
        statut: 'publie',
        sort: '-published_at',
        limit: '5'
      });
      const res = createMockRes();
      
      await handler(req, res);
      
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
    });

    it('should accept sort=alpha', async () => {
      const req = createMockReq('GET', { 
        statut: 'publie',
        sort: 'alpha',
        limit: '5'
      });
      const res = createMockRes();
      
      await handler(req, res);
      
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
    });
  });

  describe.skipIf(skipDbTests)('Demarches API (requires DB)', () => {
    it('should return 200 for basic query', async () => {
      const req = createMockReq('GET', { 
        statut: 'publie',
        limit: '3'
      });
      const res = createMockRes();
      
      await demarchesHandler(req, res);
      
      // Should NOT be 500 after migration
      expect(res.statusCode).not.toBe(500);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
    });
  });

  describe.skipIf(skipDbTests)('Structures API (requires DB)', () => {
    it('should return 200 for basic query', async () => {
      const req = createMockReq('GET', { 
        statut: 'actif',
        limit: '3'
      });
      const res = createMockRes();
      
      await structuresHandler(req, res);
      
      // Should NOT be 500 after migration
      expect(res.statusCode).not.toBe(500);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('items');
    });
  });

  describe('Health Check Pattern', () => {
    it('sitemap should never return 400 or 500 (200 or 503 allowed)', async () => {
      const req = createMockReq('GET', {});
      const res = createMockRes();
      
      await sitemapHandler(req, res);
      
      expect([200, 503]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(400);
      expect(res.statusCode).not.toBe(500);
    });
  });
});
