import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';
import sitemapHandler from '../../api/_handlers/sitemap.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

function createReq(headers = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
  };
}

function createRes() {
  const headers = {};

  return {
    statusCode: 200,
    body: '',
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
      return this;
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
      this.body = payload || '';
      return this;
    },
  };
}

afterEach(() => {
  if (typeof ORIGINAL_VERCEL_ENV === 'undefined') {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  }
});

describe('P7-E sitemap canonical origin', () => {
  it('forces www canonical origin in production regardless of incoming host', async () => {
    process.env.VERCEL_ENV = 'production';
    const originalFindMany = db.query.Aide.findMany;
    db.query.Aide.findMany = async () => [{ slug: 'aide-prod', updatedAt: new Date('2026-01-01T00:00:00.000Z') }];

    try {
      const req = createReq({
        host: 'preview-accesdirectaide.vercel.app',
        'x-forwarded-host': 'preview-accesdirectaide.vercel.app',
        'x-forwarded-proto': 'https',
      });
      const res = createRes();

      await sitemapHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(String(res.body)).toContain('<loc>https://www.accesdirectaide.fr/</loc>');
      expect(String(res.body)).toContain('<loc>https://www.accesdirectaide.fr/aides/aide-prod</loc>');
    } finally {
      db.query.Aide.findMany = originalFindMany;
    }
  });

  it('uses request origin in preview/dev environments', async () => {
    process.env.VERCEL_ENV = 'preview';
    const originalFindMany = db.query.Aide.findMany;
    db.query.Aide.findMany = async () => [{ slug: 'aide-preview', updatedAt: new Date('2026-01-01T00:00:00.000Z') }];

    try {
      const req = createReq({
        host: 'preview-accesdirectaide.vercel.app',
        'x-forwarded-host': 'preview-accesdirectaide.vercel.app',
        'x-forwarded-proto': 'https',
      });
      const res = createRes();

      await sitemapHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(String(res.body)).toContain('<loc>https://preview-accesdirectaide.vercel.app/</loc>');
      expect(String(res.body)).toContain('<loc>https://preview-accesdirectaide.vercel.app/aides/aide-preview</loc>');
    } finally {
      db.query.Aide.findMany = originalFindMany;
    }
  });
});

