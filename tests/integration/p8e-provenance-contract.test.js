import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';
import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';

/** @type {{ aideIds: string[], sourceDocumentIds: string[] }} */
const created = {
  aideIds: [],
  sourceDocumentIds: [],
};

afterEach(async () => {
  if (created.aideIds.length > 0) {
    await await db.delete(schema.Aide);
  }
  if (created.sourceDocumentIds.length > 0) {
    await await db.delete(schema.SourceDocument);
  }
  created.aideIds = [];
  created.sourceDocumentIds = [];
});

/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, string>,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    url: overrides.url || '/api/aides',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(overrides.headers || {}),
    },
    query: overrides.query || {},
    body: null,
    cookies: {},
  };
}

function createRes() {
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {Array<() => void>} */
  const finishListeners = [];

  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    on(event, listener) {
      if (event === 'finish' && typeof listener === 'function') {
        finishListeners.push(listener);
      }
      return this;
    },
    setHeader(key, value) {
      headers[String(key).toLowerCase()] = String(value);
    },
    getHeader(key) {
      return headers[String(key).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    writeHead(code, outHeaders = {}) {
      this.statusCode = code;
      for (const [key, value] of Object.entries(outHeaders)) {
        headers[String(key).toLowerCase()] = String(value);
      }
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      for (const listener of finishListeners) listener();
      return this;
    },
    send(payload) {
      this.body = payload;
      this.headersSent = true;
      for (const listener of finishListeners) listener();
      return this;
    },
    end(payload) {
      if (typeof payload !== 'undefined') this.body = payload;
      this.headersSent = true;
      for (const listener of finishListeners) listener();
      return this;
    },
  };
}

/**
 * @param {string} url
 */
async function invokeApi(url) {
  const req = createReq({ url });
  const res = createRes();
  await apiHandler(req, res);
  return res;
}

describe('P8-E provenance public contract', () => {
  it('exposes minimal provenance block on aide detail and listing without leaking source internals', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const slug = `aide-provenance-${suffix}`;
    const sourceUrl = 'https://www.service-public.fr/simulateur/calcul/apl';
    const fetchedAt = new Date('2026-02-01T08:00:00.000Z');
    // PKG-1 / D-5: a verification date is only exposed for a record that passed the publication rules, and only a CURRENT one (<= 180 d) stays public -> the date is relative to now.
    const verifiedAt = new Date(Date.now() - 20 * 86400000);

    const sourceDocument = await (await db.insert(schema.SourceDocument).values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        source_url: sourceUrl,
        fetched_at: fetchedAt,
        content_hash: `p8e-${suffix}`,
        raw_content: '<html>private raw payload</html>',
        metadata: { parserVersion: 'test' },
      }).returning({ id: schema.SourceDocument.id }))[0];
    created.sourceDocumentIds.push(sourceDocument.id);

    const aide = await (await db.insert(schema.Aide).values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        slug,
        titre: `Aide provenance ${suffix}`,
        territoires: ['national'],
        documents_necessaires: ['piece-identite'],
        statut: 'publie',
        est_urgent: false,
        date_verification: verifiedAt,
        launch_eligible: true,
        verification_status: 'VERIFIED',
        verified_by: 'reviewer-p8e@example.test',
        territory_verified: true,
        data_origin: 'official',
        source_url: sourceUrl,   // D-5: a public record needs its own official source (the SourceDocument link alone is not provenance)
        published_at: new Date('2099-01-01T00:00:00.000Z'),
        source_document_id: sourceDocument.id,
      }).returning({ id: schema.Aide.id, slug: schema.Aide.slug }))[0];
    created.aideIds.push(aide.id);

    const detailRes = await invokeApi(`/api/aides/${encodeURIComponent(aide.slug)}`);
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body?.provenance).toEqual({
      verifiedAt: verifiedAt.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      sourceUrl,
      sourceHost: 'www.service-public.fr',
      contentStatus: 'VERIFIED',
      freshness: 'current',
    });
    expect(detailRes.body).not.toHaveProperty('sourceDocument');
    // review data is internal: the reviewer identity never reaches a public payload
    expect(detailRes.body).not.toHaveProperty('verified_by');
    expect(JSON.stringify(detailRes.body)).not.toContain('reviewer-p8e@example.test');
    expect(JSON.stringify(detailRes.body)).not.toContain('raw_content');

    const listRes = await invokeApi('/api/aides?limit=10&sort=recent&page=1');
    expect(listRes.statusCode).toBe(200);
    const item = (listRes.body?.items || []).find((entry) => entry.id === aide.id);
    expect(item).toBeTruthy();
    expect(item?.provenance?.sourceHost).toBe('www.service-public.fr');
    expect(item).not.toHaveProperty('sourceDocument');
    expect(item).not.toHaveProperty('raw_content');
    expect(item).not.toHaveProperty('verified_by');
    expect(JSON.stringify(listRes.body)).not.toContain('reviewer-p8e@example.test');
  });

  it('PKG-1 / D-5: an unverified lab record shows NO verification date (its import/edit date is not a verification) and is labelled LAB_UNVERIFIED', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const slug = `aide-lab-${suffix}`;
    const aide = await (await db.insert(schema.Aide).values({
        id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), slug, titre: `Aide lab ${suffix}`, territoires: ['national'], documents_necessaires: [],
        statut: 'publie', est_urgent: false, date_verification: new Date(Date.now() - 5 * 86400000), source_url: 'https://www.service-public.fr/simulateur/calcul/apl',
      }).returning({ id: schema.Aide.id, slug: schema.Aide.slug }))[0];
    created.aideIds.push(aide.id);
    const res = await invokeApi(`/api/aides/${encodeURIComponent(aide.slug)}`);
    expect(res.statusCode).toBe(200);
    expect(res.body?.provenance?.contentStatus).toBe('LAB_UNVERIFIED');
    expect(res.body?.provenance?.verifiedAt ?? null).toBeNull();
  });
});
