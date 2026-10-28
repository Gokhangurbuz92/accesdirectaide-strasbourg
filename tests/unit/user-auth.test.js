import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildUserSessionCookie,
  getUserSessionTokenFromRequest,
  hashAuthToken,
  normalizeEmail,
  normalizeNextPath,
  signUserSessionToken,
  verifyUserSessionToken,
} from '../../api/_utils/user-auth.js';

const originalJwtSecret = process.env.JWT_SECRET;
const originalAuthSecret = process.env.AUTH_SECRET;

afterEach(() => {
  process.env.JWT_SECRET = originalJwtSecret;
  process.env.AUTH_SECRET = originalAuthSecret;
});

describe('user auth helpers', () => {
  it('normalizes emails and hashes tokens deterministically', () => {
    expect(normalizeEmail('  User@Test.Local ')).toBe('user@test.local');
    expect(hashAuthToken('abc')).toBe(hashAuthToken('abc'));
    expect(hashAuthToken('abc')).not.toBe(hashAuthToken('abcd'));
  });

  it('signs and verifies user session tokens', () => {
    process.env.AUTH_SECRET = 'p10b-auth-secret';
    const token = signUserSessionToken({
      userId: 'user-1',
      email: 'person@test.local',
    });

    const payload = verifyUserSessionToken(token);
    expect(payload).toMatchObject({
      userId: 'user-1',
      email: 'person@test.local',
      role: 'user',
      scope: 'user',
    });
  });

  it('extracts user session cookie and rejects unsafe next redirects', () => {
    const cookie = buildUserSessionCookie('token-value');
    const req = {
      headers: { cookie },
      cookies: {},
    };
    expect(getUserSessionTokenFromRequest(req)).toBe('token-value');
    expect(normalizeNextPath('https://evil.example', '/annuaire')).toBe('/annuaire');
    expect(normalizeNextPath('/rdv/structure-test', '/annuaire')).toBe('/rdv/structure-test');
  });
});

