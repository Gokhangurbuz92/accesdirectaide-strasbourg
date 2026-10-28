import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';

import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql, inArray, and, or, isNotNull } from 'drizzle-orm';

/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    url: overrides.url || '/api/pdf/aides/test',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(overrides.headers || {}),
    },
    query: {},
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
      if (event === 'finish' && typeof listener === 'function') finishListeners.push(listener);
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

function extractPdfSignature(body) {
  const buffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body instanceof Uint8Array ? body : String(body || ''), body ? undefined : 'utf8');
  return buffer.subarray(0, 5).toString('utf8');
}

describe('P10-3 PDF export', () => {
  it('returns application/pdf for a published aide', async () => {
    const aide = await db.query.Aide.findFirst({ where: and(eq(schema.Aide.statut, 'publie'), isNotNull(schema.Aide.slug)) /* AUTOMIGRATED: {         statut: 'publie',         slug: { not: null },       },       select: { slug: true },      */ });
    if (!aide?.slug) return; // No published aide in DB — skip gracefully

    const res = await invokeApi(`/api/pdf/aides/${encodeURIComponent(aide.slug)}`);

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('content-type')).toLowerCase()).toContain('application/pdf');
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(extractPdfSignature(res.body)).toBe('%PDF-');
  });

  it('returns application/pdf for a published demarche', async () => {
    const demarche = await db.query.Demarche.findFirst({ where: and(eq(schema.Demarche.statut, 'publie'), isNotNull(schema.Demarche.slug)) /* AUTOMIGRATED: {         statut: 'publie',         slug: { not: null },       },       select: { slug: true },      */ });
    if (!demarche?.slug) return; // No published demarche in DB — skip gracefully

    const res = await invokeApi(`/api/pdf/demarches/${encodeURIComponent(demarche.slug)}`);

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('content-type')).toLowerCase()).toContain('application/pdf');
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(extractPdfSignature(res.body)).toBe('%PDF-');
  });
});
