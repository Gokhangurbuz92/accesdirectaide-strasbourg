import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';

import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';

vi.stubEnv('KV_REST_API_URL', 'mock-url');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
vi.mock('@vercel/kv', () => ({
  createClient: vi.fn(),
  kv: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
  }
}));

import { eq, sql, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

// PKG-6 / D22 overlay (owner decision 2026-10-21, D22_AUTH_OVERLAY_V1.md): the only change to this RC4 test. Review-queue writes now need a NAMED administrator
// session with MFA (the retired shared ADMIN_TOKEN is refused for writes); the requests below are signed for a SYNTHETIC named administrator. Every functional
// assertion is unchanged. Negative cases (anonymous, pro, legacy token, no MFA, non-admin) are in tests/integration/pkg6-d22-auth-entry-db.test.js.
let adminSession = null;
async function adminSessionHeader() {
  if (!adminSession) adminSession = (await import('../../api/_utils/auth.js')).signAdminSessionToken({ email: 'p8c-reviewer@example.test', role: 'admin', mfa_verified: true });
  return { authorization: `Bearer ${adminSession}` };
}

/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, string>,
 *   body?: unknown,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    url: overrides.url || '/api/admin/review-queue',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(overrides.headers || {}),
    },
    query: overrides.query || {},
    body: overrides.body || null,
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
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, string>,
 *   body?: unknown,
 * }} options
 */
async function invokeApi(url, options = {}) {
  const req = createReq({
    method: options.method,
    url,
    headers: options.headers,
    query: options.query,
    body: options.body,
  });
  const res = createRes();
  await apiHandler(req, res);
  return res;
}

/** @type {Array<{ type: 'aide' | 'demarche' | 'structure' | 'actualite', id: string }>} */
const createdEntities = [];

afterEach(async () => {
  if (createdEntities.length === 0) return;

  // Delete only review queue items belonging to test entities (not all items)
  const entityIds = createdEntities.map((entry) => entry.id);
  for (const id of entityIds) {
    await db.delete(schema.ReviewQueueItem).where(eq(schema.ReviewQueueItem.entityId, id));
  }

  const aideIds = createdEntities.filter((entry) => entry.type === 'aide').map((entry) => entry.id);
  const demarcheIds = createdEntities.filter((entry) => entry.type === 'demarche').map((entry) => entry.id);

  for (const id of aideIds) {
    await db.delete(schema.Aide).where(eq(schema.Aide.id, id));
  }
  for (const id of demarcheIds) {
    await db.delete(schema.Demarche).where(eq(schema.Demarche.id, id));
  }

  createdEntities.length = 0;
});

async function createAideForReviewQueue() {
  const aide = await (await db.insert(schema.Aide).values({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      titre: `RQ aide ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      territoires: ['FRANCE'],
      documents_necessaires: [],
      date_verification: null,
      slug: null,
      statut: 'publie',
    }).returning({ id: schema.Aide.id, titre: schema.Aide.titre }))[0];
  createdEntities.push({ type: 'aide', id: aide.id });
  return aide;
}

async function createStaleDemarche() {
  const demarche = await (await db.insert(schema.Demarche).values({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      titre: `RQ demarche stale ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      documents_necessaires: ['piece-identite'],
      slug: `rq-demarche-stale-${Math.random().toString(16).slice(2, 10)}`,
      date_verification: new Date(Date.now() - 900 * 24 * 60 * 60 * 1000),
      statut: 'publie',
    }).returning({ id: schema.Demarche.id, titre: schema.Demarche.titre }))[0];
  createdEntities.push({ type: 'demarche', id: demarche.id });
  return demarche;
}

describe('P8-C Review Queue contracts', () => {
  it('scan creates open items for missing verification + missing required field + missing slug', async () => {
    const aide = await createAideForReviewQueue();

    const scanRes = await invokeApi('/api/admin/review-queue/scan', {
      method: 'POST',
      headers: await adminSessionHeader(),
      body: { limitPerType: 200 },
    });
    console.log("SCAN RES BODY:", scanRes.body);

    expect(scanRes.statusCode).toBe(200);
    expect(scanRes.body?.ok).toBe(true);
    expect(String(scanRes.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(scanRes.getHeader('x-robots-tag')).toBe('noindex, nofollow');

    const openItems = await db.select({ reason: schema.ReviewQueueItem.reason }).from(schema.ReviewQueueItem).where(
      and(
        eq(schema.ReviewQueueItem.entityType, 'AIDE'),
        eq(schema.ReviewQueueItem.entityId, aide.id),
        eq(schema.ReviewQueueItem.status, 'OPEN')
      )
    );

    const reasons = new Set(openItems.map((item) => item.reason));
    expect(reasons.has('MISSING_VERIFICATION')).toBe(true);
    expect(reasons.has('MISSING_REQUIRED_FIELD:documents_necessaires')).toBe(true);
    expect(reasons.has('MISSING_SLUG')).toBe(true);
  });

  it('scan is idempotent for open items', async () => {
    const aide = await createAideForReviewQueue();

    await invokeApi('/api/admin/review-queue/scan', {
      method: 'POST',
      headers: await adminSessionHeader(),
      body: { limitPerType: 200 },
    });

    await invokeApi('/api/admin/review-queue/scan', {
      method: 'POST',
      headers: await adminSessionHeader(),
      body: { limitPerType: 200 },
    });

    const count = Number(await (await db.select({ count: sql`count(*)` }).from(schema.ReviewQueueItem))[0].count);

    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('GET list status=open returns review queue items', async () => {
    const aide = await createAideForReviewQueue();

    const scanRes = await invokeApi('/api/admin/review-queue/scan', {
      method: 'POST',
      headers: await adminSessionHeader(),
      body: { limitPerType: 200 },
    });

    const listRes = await invokeApi('/api/admin/review-queue?status=open&entityType=aide&limit=50', {
      method: 'GET',
      headers: await adminSessionHeader(),
      query: { status: 'open', entityType: 'aide', limit: '50' },
    });

    expect(listRes.statusCode).toBe(200);
    console.log("TEST 3 LIST BODY", listRes.body);
    expect(listRes.body?.ok).toBe(true);
    const target = (listRes.body?.items || []).find((item) => item.entityId === aide.id);
    expect(target).toBeTruthy();
  });

  it('PATCH status=resolved updates item status and removes it from open filter', async () => {
    const aide = await createAideForReviewQueue();

    await invokeApi('/api/admin/review-queue/scan', {
      method: 'POST',
      headers: await adminSessionHeader(),
      body: { limitPerType: 200 },
    });

    const openItems = await db.select({ id: schema.ReviewQueueItem.id }).from(schema.ReviewQueueItem).where(
      and(
        eq(schema.ReviewQueueItem.entityType, 'AIDE'),
        eq(schema.ReviewQueueItem.entityId, aide.id),
        eq(schema.ReviewQueueItem.status, 'OPEN')
      )
    ).orderBy(desc(schema.ReviewQueueItem.createdAt)).limit(1);

    const targetId = openItems[0]?.id;
    console.log("TEST 4 OPEN ITEMS", openItems);
    expect(typeof targetId).toBe('string');

    const patchRes = await invokeApi(`/api/admin/review-queue/${targetId}`, {
      method: 'PATCH',
      headers: await adminSessionHeader(),
      body: { status: 'resolved' },
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.body?.item?.status).toBe('resolved');

    const openAfterPatch = await invokeApi('/api/admin/review-queue?status=open&entityType=aide&limit=50', {
      method: 'GET',
      headers: await adminSessionHeader(),
      query: { status: 'open', entityType: 'aide', limit: '50' },
    });

    const stillOpen = (openAfterPatch.body?.items || []).find((item) => item.id === targetId);
    expect(stillOpen).toBeUndefined();
  });

  it('scan creates STALE_VERIFICATION for an old verification date', async () => {
    const demarche = await createStaleDemarche();

    const scanRes = await invokeApi('/api/admin/review-queue/scan', {
      method: 'POST',
      headers: await adminSessionHeader(),
      body: { limitPerType: 1000 },
    });

    expect(scanRes.statusCode).toBe(200);

    const staleItem = await db.query.ReviewQueueItem.findFirst({
      where: and(
        eq(schema.ReviewQueueItem.entityType, 'DEMARCHE'),
        eq(schema.ReviewQueueItem.entityId, demarche.id),
        eq(schema.ReviewQueueItem.status, 'OPEN'),
        eq(schema.ReviewQueueItem.reason, 'STALE_VERIFICATION')
      ),
      columns: { id: true, details: true },
    });

    expect(staleItem).toBeTruthy();
    const details = /** @type {{ ageDays?: number } | null | undefined } */ (staleItem?.details);
    expect(typeof details?.ageDays).toBe('number');
    expect(Number(details?.ageDays)).toBeGreaterThan(365);
  });
});
