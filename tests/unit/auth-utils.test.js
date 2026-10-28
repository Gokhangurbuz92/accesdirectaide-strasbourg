import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';

import {
  requireAdminAuth,
  requireProAuth,
  resolveAuthContext,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from '../../api/_utils/auth.js';
import { signProToken } from '../../api/_utils/auth.js';

const originalAuthMode = process.env.AUTH_MODE;
const originalAuthSecret = process.env.AUTH_SECRET;
const originalAdminToken = process.env.ADMIN_TOKEN;
const originalJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  process.env.AUTH_MODE = originalAuthMode;
  process.env.AUTH_SECRET = originalAuthSecret;
  process.env.ADMIN_TOKEN = originalAdminToken;
  process.env.JWT_SECRET = originalJwtSecret;
});

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = String(value);
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
  };
}

describe('auth utils foundation (P9-A)', () => {
  it('signs and verifies admin session JWT when AUTH_SECRET is configured', () => {
    process.env.AUTH_MODE = 'jwt';
    process.env.AUTH_SECRET = 'unit-test-auth-secret';

    const token = signAdminSessionToken({ email: 'admin@test.local', role: 'admin' });
    const payload = verifyAdminSessionToken(token);

    expect(typeof token).toBe('string');
    expect(payload).toMatchObject({
      scope: 'admin',
      role: 'admin',
      email: 'admin@test.local',
    });
  });

  it('resolves admin auth context from legacy ADMIN_TOKEN bearer', async () => {
    process.env.ADMIN_TOKEN = 'unit-test-admin-token';
    const auth = await resolveAuthContext({
      headers: { authorization: 'Bearer unit-test-admin-token' },
    });

    expect(auth).toMatchObject({
      role: 'admin',
      authType: 'admin_token',
    });
  });

  it('rejects malformed or unknown bearer tokens', async () => {
    process.env.ADMIN_TOKEN = 'unit-test-admin-token';
    process.env.AUTH_SECRET = 'unit-test-auth-secret';

    const auth = await resolveAuthContext({
      headers: { authorization: 'Bearer invalid.token.value' },
    });

    expect(auth).toBeNull();
  });

  it('requireProAuth accepts only Pro JWT and rejects admin token/admin JWT', async () => {
    process.env.JWT_SECRET = 'unit-test-jwt-secret';
    process.env.AUTH_SECRET = 'unit-test-auth-secret';
    process.env.ADMIN_TOKEN = 'unit-test-admin-token';

    const wrapped = requireProAuth(async (req, res) => {
      return res.status(200).json({ ok: true, user: req.user });
    });

    const noTokenRes = createRes();
    await wrapped({ headers: {} }, noTokenRes);
    expect(noTokenRes.statusCode).toBe(401);

    const adminTokenRes = createRes();
    await wrapped({ headers: { authorization: 'Bearer unit-test-admin-token' } }, adminTokenRes);
    expect(adminTokenRes.statusCode).toBe(401);

    const adminJwt = signAdminSessionToken({ email: 'admin@test.local', role: 'admin' });
    const adminJwtRes = createRes();
    await wrapped({ headers: { authorization: `Bearer ${adminJwt}` } }, adminJwtRes);
    expect(adminJwtRes.statusCode).toBe(401);

    const proJwt = signProToken({
      id: 'pro-guard-user',
      email: 'pro@test.local',
      role: 'STRUCTURE_ADMIN',
      structureId: 'structure-guard',
    });
    const proRes = createRes();
    await wrapped({ headers: { authorization: `Bearer ${proJwt}` } }, proRes);
    expect(proRes.statusCode).toBe(200);
    expect(proRes.body).toMatchObject({
      ok: true,
      user: {
        userId: 'pro-guard-user',
        structureId: 'structure-guard',
        role: 'structure_admin',
      },
    });
    expect(proRes.headers['cache-control']).toContain('no-store');
  });

  it('requireAdminAuth rejects pro JWT', async () => {
    process.env.JWT_SECRET = 'unit-test-jwt-secret';
    process.env.ADMIN_TOKEN = 'unit-test-admin-token';

    const wrapped = requireAdminAuth(async (_req, res) => res.status(200).json({ ok: true }));
    const proJwt = signProToken({
      id: 'pro-user-2',
      email: 'pro2@test.local',
      role: 'PRO',
      structureId: 'structure-2',
    });

    const res = createRes();
    await wrapped({ headers: { authorization: `Bearer ${proJwt}` } }, res);
    expect(res.statusCode).toBe(403);
  });
});
