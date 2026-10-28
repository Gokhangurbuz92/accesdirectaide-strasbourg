import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import demarchesHandler from '../../api/_handlers/demarches.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

function createMockReq({ method = 'GET', url = '/api/demarches', query = {}, headers = {} } = {}) {
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
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}

const hasDatabase = !!process.env.DATABASE_URL;

describe.skipIf(!hasDatabase)('P10-0 public credibility guards', () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const hiddenSlug = `demarche-hidden-${suffix}`;
  const visibleSlug = `demarche-visible-${suffix}`;

  beforeEach(async () => {
    // Clean up any leftover test data first
    await db.delete(schema.Demarche).where(eq(schema.Demarche.slug, hiddenSlug));
    await db.delete(schema.Demarche).where(eq(schema.Demarche.slug, visibleSlug));

    const now = new Date();
    await db.insert(schema.Demarche).values([
      {
        slug: hiddenSlug,
        titre: 'Démarche Test interne',
        statut: 'publie',
        published_at: now,
        description_courte: 'Doit etre masquee en public.',
        quality_score: 50,
        documents_necessaires: [],
        mots_cles: [],
        audiences: [],
        departements: [],
        region_codes: [],
        department_codes: [],
        insee_codes: [],
      },
      {
        slug: visibleSlug,
        titre: 'Demander une domiciliation',
        statut: 'publie',
        published_at: now,
        description_courte: 'Doit rester visible en public.',
        quality_score: 50,
        documents_necessaires: [],
        mots_cles: [],
        audiences: [],
        departements: [],
        region_codes: [],
        department_codes: [],
        insee_codes: [],
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(schema.Demarche).where(eq(schema.Demarche.slug, hiddenSlug));
    await db.delete(schema.Demarche).where(eq(schema.Demarche.slug, visibleSlug));
  });

  it('list endpoint excludes test-labeled demarches on public surface', async () => {
    const req = createMockReq({
      url: '/api/demarches?limit=50',
      query: { limit: '50' },
    });
    const res = createMockRes();

    await demarchesHandler(req, res);

    expect(res.statusCode).toBe(200);
    const items = Array.isArray(res.body?.items) ? res.body.items : [];
    const slugs = items.map((item) => item.slug);
    expect(slugs).toContain(visibleSlug);
    expect(slugs).not.toContain(hiddenSlug);
  });

  it('detail endpoint hides test-labeled demarches for public but keeps admin access', async () => {
    const publicReq = createMockReq({
      url: `/api/demarches/${hiddenSlug}`,
      query: {},
    });
    const publicRes = createMockRes();
    await demarchesHandler(publicReq, publicRes);
    expect(publicRes.statusCode).toBe(404);

    const adminReq = createMockReq({
      url: `/api/demarches/${hiddenSlug}`,
      query: {},
      headers: {
        authorization: `Bearer ${process.env.ADMIN_TOKEN || ''}`,
      },
    });
    const adminRes = createMockRes();
    await demarchesHandler(adminReq, adminRes);

    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.body?.slug).toBe(hiddenSlug);
  });
});
