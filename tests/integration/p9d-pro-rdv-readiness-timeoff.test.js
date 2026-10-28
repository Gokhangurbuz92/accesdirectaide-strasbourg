import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { signProToken } from '../../api/_utils/auth.js';
import { getProRdvReadiness } from '../../api/_utils/pro-rdv-readiness.js';

vi.mock('../../api/_utils/pro-rdv-readiness.js', () => ({
  getProRdvReadiness: vi.fn(),
  REQUIRED_PRO_RDV_TABLES: ['ProRdvService', 'ProAvailabilityRule', 'ProAppointment', 'ProTimeOff'],
  REQUIRED_PRO_RDV_MIGRATIONS: ['20260305000000_add_pro_rdv_core'],
}));

vi.mock('@vercel/kv', () => {
  const counters = new Map();
  const mockKv = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockImplementation(async (key) => {
      const current = (counters.get(key) || 0) + 1;
      counters.set(key, current);
      return current;
    }),
    del: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  return {
    __esModule: true,
    createClient: vi.fn(() => mockKv),
    kv: mockKv,
    default: mockKv,
  };
});

/**
 * @param {{
 *   method?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, any>,
 *   body?: unknown,
 * }} overrides
 */
function createReq(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    url: overrides.url || '/api/monitor/pro-rdv',
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
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   query?: Record<string, any>,
 *   body?: unknown,
 * }} options
 */
async function invokeApi(url, options = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  const queryFromUrl = Object.fromEntries(parsedUrl.searchParams.entries());
  const req = createReq({
    method: options.method,
    url,
    headers: options.headers,
    query: { ...queryFromUrl, ...(options.query || {}) },
    body: options.body,
  });
  const res = createRes();
  try {
    await Promise.race([
      apiHandler(req, res),
      new Promise((_, r) => setTimeout(() => r(new Error('apiHandler manually timed out in invokeApi!')), 4000)),
    ]);
  } catch (err) {
    console.error('INVOKE_API_ERROR:', err);
    throw err;
  }
  return res;
}

function getSqlFromQuery(query) {
  return String(query && query.query ? query.query : query || '');
}

const originalJwtSecret = process.env.JWT_SECRET;
const originalAdminToken = process.env.ADMIN_TOKEN;
const originalReadPerMin = process.env.PRO_RDV_RATE_LIMIT_READ_PER_MIN;
const originalWritePerMin = process.env.PRO_RDV_RATE_LIMIT_WRITE_PER_MIN;
const originalWritePerDay = process.env.PRO_RDV_RATE_LIMIT_WRITE_PER_DAY;



/** @type {string[]} */
let createdStructureIds = [];
/** @type {string[]} */
let createdProUserIds = [];
/** @type {string[]} */
let createdTimeOffIds = [];

beforeEach(() => {
  vi.restoreAllMocks();
  getProRdvReadiness.mockResolvedValue({
    ok: true,
    missingTables: [],
  });
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'p9d-test-jwt-secret';
  process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'p9d-test-admin-token';
});

afterEach(async () => {
  vi.restoreAllMocks();

  if (createdTimeOffIds.length > 0) {
    await db.delete(schema.ProTimeOff);
  }
  if (createdProUserIds.length > 0) {
    await db.delete(schema.ProUser);
  }
  if (createdStructureIds.length > 0) {
    await db.delete(schema.Structure);
  }

  createdTimeOffIds = [];
  createdProUserIds = [];
  createdStructureIds = [];

  process.env.JWT_SECRET = originalJwtSecret;
  process.env.ADMIN_TOKEN = originalAdminToken;
  process.env.PRO_RDV_RATE_LIMIT_READ_PER_MIN = originalReadPerMin;
  process.env.PRO_RDV_RATE_LIMIT_WRITE_PER_MIN = originalWritePerMin;
  process.env.PRO_RDV_RATE_LIMIT_WRITE_PER_DAY = originalWritePerDay;
});

async function createProFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date();
  const structureA = await (await db.insert(schema.Structure).values({
      id: crypto.randomUUID(), createdAt: now, updatedAt: now,
      nom: `P9D Structure A ${suffix}`,
      slug: `p9d-structure-a-${suffix}`,
      services: [],
      publics_accueillis: [],
      categories_aidees: [],
      mots_cles: [],
      region_codes: [],
      department_codes: [],
      insee_codes: [],
      is_pro_enabled: true,
      accessibilite_pmr: false,
    },
  ).returning())[0];
  const structureB = await (await db.insert(schema.Structure).values({
      id: crypto.randomUUID(), createdAt: now, updatedAt: now,
      nom: `P9D Structure B ${suffix}`,
      slug: `p9d-structure-b-${suffix}`,
      services: [],
      publics_accueillis: [],
      categories_aidees: [],
      mots_cles: [],
      region_codes: [],
      department_codes: [],
      insee_codes: [],
      is_pro_enabled: true,
      accessibilite_pmr: false,
    },
  ).returning())[0];

  const proUserA = await (await db.insert(schema.ProUser).values({
      id: crypto.randomUUID(), createdAt: now, updatedAt: now,
      email: `p9d-a-${suffix}@test.local`,
      password_hash: 'hashed',
      role: 'STRUCTURE_ADMIN',
      status: 'active',
      structureId: structureA.id,
    },
  ).returning())[0];
  const proUserB = await (await db.insert(schema.ProUser).values({
      id: crypto.randomUUID(), createdAt: now, updatedAt: now,
      email: `p9d-b-${suffix}@test.local`,
      password_hash: 'hashed',
      role: 'STRUCTURE_ADMIN',
      status: 'active',
      structureId: structureB.id,
    },
  ).returning())[0];

  createdStructureIds.push(structureA.id, structureB.id);
  createdProUserIds.push(proUserA.id, proUserB.id);

  return { structureA, structureB, proUserA, proUserB };
}

describe('P9-D readiness monitor + pro timeoff contract', () => {
  it('GET /api/monitor/pro-rdv returns 200 with required table checks and technical headers', async () => {
    const res = await invokeApi('/api/monitor/pro-rdv');

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      checkedAt: expect.any(String),
      env: expect.any(String),
      missingTables: [],
    });
  });

  it('GET /api/monitor/pro-rdv returns 200 with ok:false when one required table is missing', async () => {
    getProRdvReadiness.mockResolvedValue({
      ok: false,
      missingTables: ['ProTimeOff'],
    });

    const res = await invokeApi('/api/monitor/pro-rdv');

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.getHeader('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.body).toMatchObject({
      ok: false,
      missingTables: ['ProTimeOff'],
    });
  });

  it('returns 429 when pro write limit is exceeded on /api/pro/timeoff', async () => {
    process.env.PRO_RDV_RATE_LIMIT_WRITE_PER_MIN = '1';
    process.env.PRO_RDV_RATE_LIMIT_READ_PER_MIN = '60';
    process.env.PRO_RDV_RATE_LIMIT_WRITE_PER_DAY = '300';

    const fixture = await createProFixture();
    const token = signProToken({
      id: fixture.proUserA.id,
      email: fixture.proUserA.email,
      structureId: fixture.structureA.id,
      role: fixture.proUserA.role,
    });

    const first = await invokeApi('/api/pro/timeoff', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        startAt: '2026-04-04T08:00:00.000Z',
        endAt: '2026-04-04T09:00:00.000Z',
        reason: 'Formation',
      },
    });
    expect(first.statusCode).toBe(201);
    createdTimeOffIds.push(first.body.item.id);

    const second = await invokeApi('/api/pro/timeoff', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        startAt: '2026-04-04T10:00:00.000Z',
        endAt: '2026-04-04T11:00:00.000Z',
        reason: 'Atelier',
      },
    });

    expect(second.statusCode).toBe(429);
    expect(second.body).toMatchObject({
      error: 'Too Many Requests',
      code: 'PRO_RATE_LIMITED',
    });
    expect(String(second.getHeader('retry-after') || '')).not.toBe('');
    expect(String(second.getHeader('x-ratelimit-limit') || '')).toBe('1');
    expect(String(second.getHeader('x-ratelimit-remaining') || '')).toBe('0');
  });

  it('enforces pro-only auth and tenancy on /api/pro/timeoff', async () => {
    const fixture = await createProFixture();
    const tokenA = signProToken({
      id: fixture.proUserA.id,
      email: fixture.proUserA.email,
      structureId: fixture.structureA.id,
      role: fixture.proUserA.role,
    });
    const tokenB = signProToken({
      id: fixture.proUserB.id,
      email: fixture.proUserB.email,
      structureId: fixture.structureB.id,
      role: fixture.proUserB.role,
    });

    const noAuth = await invokeApi('/api/pro/timeoff');
    expect(noAuth.statusCode).toBe(401);

    const adminAuth = await invokeApi('/api/pro/timeoff', {
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    });
    expect(adminAuth.statusCode).toBe(401);

    const create = await invokeApi('/api/pro/timeoff', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}` },
      body: {
        startAt: '2026-03-04T09:00:00.000Z',
        endAt: '2026-03-04T10:00:00.000Z',
        reason: 'Formation',
      },
    });
    expect(create.statusCode).toBe(201);
    const timeOffId = create.body.item.id;
    createdTimeOffIds.push(timeOffId);

    const list = await invokeApi('/api/pro/timeoff', {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.some((item) => item.id === timeOffId)).toBe(true);

    const crossTenantDelete = await invokeApi(`/api/pro/timeoff?id=${encodeURIComponent(timeOffId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossTenantDelete.statusCode).toBe(404);   // R7: another organization's absence answers like an unknown one (a 403 confirmed it exists)

    const patch = await invokeApi('/api/pro/timeoff', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tokenA}` },
      body: {
        id: timeOffId,
        reason: 'Conges',
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.body.item.reason).toBe('Conges');

    const deleteOwn = await invokeApi(`/api/pro/timeoff?id=${encodeURIComponent(timeOffId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(deleteOwn.statusCode).toBe(200);
    expect(deleteOwn.body).toMatchObject({ ok: true, id: timeOffId });
  });
});
