import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getProRdvReadiness } from '../../api/_utils/pro-rdv-readiness.js';

import apiHandler from '../../api/index.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { signProToken } from '../../api/_utils/auth.js';

vi.mock('../../api/_utils/pro-rdv-readiness.js', () => ({
  getProRdvReadiness: vi.fn(),
  REQUIRED_PRO_RDV_TABLES: ['ProRdvService', 'ProAvailabilityRule', 'ProAppointment', 'ProTimeOff'],
  REQUIRED_PRO_RDV_MIGRATIONS: ['20260305000000_add_pro_rdv_core'],
}));

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
    url: overrides.url || '/api/pro/rdv/settings',
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
    await apiHandler(req, res);
  } catch (e) {
    console.error('API HANDLER CRASH:', e.stack);
    res.statusCode = 500;
  }
  if (res.statusCode >= 400) {
    console.error('API Response Body:', res.body);
  }
  return res;
}

function getSqlFromQuery(query) {
  return String(query && query.query ? query.query : query || '');
}

const originalJwtSecret = process.env.JWT_SECRET;
const originalAdminToken = process.env.ADMIN_TOKEN;



/** @type {string[]} */
let createdStructureIds = [];
/** @type {string[]} */
let createdProUserIds = [];

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'p10c-test-jwt-secret';
  process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'p10c-test-admin-token';
});

afterEach(async () => {
  vi.restoreAllMocks();

  if (createdProUserIds.length > 0) {
    await await db.delete(schema.ProUser);
  }
  if (createdStructureIds.length > 0) {
    await await db.delete(schema.Structure);
  }

  createdStructureIds = [];
  createdProUserIds = [];

  process.env.JWT_SECRET = originalJwtSecret;
  process.env.ADMIN_TOKEN = originalAdminToken;
});

async function createProFixture(isProEnabled = false) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date();
  const structure = await (await db.insert(schema.Structure).values({
      id: crypto.randomUUID(),
      nom: `P10C Structure ${suffix}`,
      createdAt: now,
      updatedAt: now,
      slug: `p10c-structure-${suffix}`,
      services: [],
      publics_accueillis: [],
      categories_aidees: [],
      mots_cles: [],
      region_codes: [],
      department_codes: [],
      insee_codes: [],
      is_pro_enabled: isProEnabled,
      accessibilite_pmr: false,
    },
  ).returning())[0];

  const proUser = await (await db.insert(schema.ProUser).values({
      id: crypto.randomUUID(),
      email: `p10c-${suffix}@test.local`,
      createdAt: now,
      updatedAt: now,
      password_hash: 'hashed',
      role: 'STRUCTURE_ADMIN',
      status: 'active',
      structureId: structure.id,
    },
  ).returning())[0];

  createdStructureIds.push(structure.id);
  createdProUserIds.push(proUser.id);

  return { structure, proUser };
}

describe('P10-C pro rdv publish settings', () => {
  it('requires pro auth for /api/pro/rdv/settings', async () => {
    const noAuth = await invokeApi('/api/pro/rdv/settings');
    expect(noAuth.statusCode).toBe(401);

    const adminAuth = await invokeApi('/api/pro/rdv/settings', {
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    });
    expect(adminAuth.statusCode).toBe(401);
  });

  it('GET lazily creates settings with default unpublished value', async () => {
    const fixture = await createProFixture(false);
    const token = signProToken({
      id: fixture.proUser.id,
      email: fixture.proUser.email,
      structureId: fixture.structure.id,
      role: fixture.proUser.role,
    });

    const res = await invokeApi('/api/pro/rdv/settings', {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(String(res.getHeader('cache-control')).toLowerCase()).toContain('no-store');
    expect(res.body).toMatchObject({
      structureId: fixture.structure.id,
      isPublished: false,
      bookingMode: 'IN_PERSON',
    });

    const inDb = await db.query.StructureRdvSettings.findFirst({ where: eq(schema.StructureRdvSettings.structureId, fixture.structure.id) });
    expect(inDb).toBeTruthy();
    expect(inDb?.isPublished).toBe(false);
  });

  it('PUT publishes when readiness is healthy and syncs legacy is_pro_enabled', async () => {
    const fixture = await createProFixture(false);
    const token = signProToken({
      id: fixture.proUser.id,
      email: fixture.proUser.email,
      structureId: fixture.structure.id,
      role: fixture.proUser.role,
    });

    getProRdvReadiness.mockResolvedValue({
      ok: true,
      missingTables: [],
    });

    const res = await invokeApi('/api/pro/rdv/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      body: {
        isPublished: true,
        bookingMode: 'BOTH',
        contactEmail: 'rdv@test.local',
        contactPhone: '+33 6 12 34 56 78',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      isPublished: true,
      bookingMode: 'BOTH',
      contactEmail: 'rdv@test.local',
    });

    const structure = await db.query.Structure.findFirst({ where: eq(schema.Structure.id, fixture.structure.id) });
    expect(structure?.is_pro_enabled).toBe(true);

    const settings = await db.query.StructureRdvSettings.findFirst({ where: eq(schema.StructureRdvSettings.structureId, fixture.structure.id) });
    expect(settings?.isPublished).toBe(true);
    expect(settings?.bookingMode).toBe('BOTH');
  });

  it('PUT returns 409 when publish is requested but readiness is not ready', async () => {
    const fixture = await createProFixture(false);
    const token = signProToken({
      id: fixture.proUser.id,
      email: fixture.proUser.email,
      structureId: fixture.structure.id,
      role: fixture.proUser.role,
    });

    getProRdvReadiness.mockResolvedValue({
      ok: false,
      missingTables: ['ProTimeOff'],
    });

    const res = await invokeApi('/api/pro/rdv/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      body: {
        isPublished: true,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'rdv_not_ready',
      missingTables: ['ProTimeOff'],
    });

    const structure = await db.query.Structure.findFirst({ where: eq(schema.Structure.id, fixture.structure.id) });
    expect(structure?.is_pro_enabled).toBe(false);
  });
});
