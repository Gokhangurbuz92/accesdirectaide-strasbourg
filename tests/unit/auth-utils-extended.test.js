/**
 * Auth Utils — Extended Test Suite
 *
 * Tests: signJwt/verifyJwt, signProToken/verifyProToken,
 * token expiration, isAdminRole/isProRole, resolveAuthContext edge cases
 */
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

import {
  signJwt,
  verifyJwt,
  signProToken,
  verifyProToken,
  isAdminRole,
  isProRole,
  resolveAuthContext,
  signAdminSessionToken,
  verifyAdminSessionToken,
  AUTH_ROLE,
} from '../../api/_utils/auth.js';

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-extended';
  process.env.AUTH_SECRET = 'test-auth-secret-extended';
});

afterEach(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

describe('signJwt / verifyJwt low-level', () => {
  it('signs a payload and verifies it with the same secret', () => {
    const token = signJwt({ sub: 'user-1', role: 'admin' }, 'my-secret');
    const decoded = verifyJwt(token, 'my-secret');
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('admin');
  });

  it('rejects verification with wrong secret', () => {
    const token = signJwt({ sub: 'user-1' }, 'correct-secret');
    expect(() => verifyJwt(token, 'wrong-secret')).toThrow();
  });

  it('rejects tampered tokens', () => {
    const token = signJwt({ sub: 'user-1' }, 'secret');
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyJwt(tampered, 'secret')).toThrow();
  });

  it('supports expiration (expiresIn)', async () => {
    const token = signJwt({ sub: 'user-1' }, 'secret', { expiresIn: '1s' });
    // Immediately should be valid
    const decoded = verifyJwt(token, 'secret');
    expect(decoded.sub).toBe('user-1');
    expect(decoded.exp).toBeDefined();
  });

  it('rejects completely invalid token strings', () => {
    expect(() => verifyJwt('not-a-jwt', 'secret')).toThrow();
    expect(() => verifyJwt('', 'secret')).toThrow();
  });
});

describe('signProToken / verifyProToken', () => {
  it('signs a Pro token with required fields and verifies it', () => {
    const token = signProToken({
      id: 'pro-user-1',
      email: 'pro@test.fr',
      role: 'STRUCTURE_ADMIN',
      structureId: 'struct-1',
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const verified = verifyProToken(token);
    expect(verified).not.toBeNull();
    expect(verified.userId).toBe('pro-user-1');
    expect(verified.structureId).toBe('struct-1');
    expect(verified.role).toBe('STRUCTURE_ADMIN');
    expect(verified.scope).toBe('pro');
  });

  it('includes a unique jti (JWT ID) in each signed token', () => {
    const token1 = signProToken({ id: 'u1', email: 'a@b.fr', role: 'PRO', structureId: 's1' });
    const token2 = signProToken({ id: 'u1', email: 'a@b.fr', role: 'PRO', structureId: 's1' });

    // Decode raw JWTs to check JTI (verifyProToken strips it)
    const d1 = verifyJwt(token1, process.env.JWT_SECRET);
    const d2 = verifyJwt(token2, process.env.JWT_SECRET);
    expect(d1.jti).toBeDefined();
    expect(d2.jti).toBeDefined();
    expect(d1.jti).not.toBe(d2.jti);
  });

  it('returns null for an invalid token', () => {
    const result = verifyProToken('invalid.token.value');
    expect(result).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = signProToken({
      id: 'u1',
      email: 'a@b.fr',
      role: 'PRO',
      structureId: 's1',
    });
    // Change secret
    process.env.JWT_SECRET = 'different-secret-now';
    const result = verifyProToken(token);
    expect(result).toBeNull();
  });

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() =>
      signProToken({ id: 'u1', email: 'a@b.fr', role: 'PRO', structureId: 's1' })
    ).toThrow('JWT_SECRET is missing');
  });
});

describe('isAdminRole / isProRole', () => {
  it('identifies admin roles correctly', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('ADMIN')).toBe(true);
    expect(isAdminRole('superadmin')).toBe(true);
    expect(isAdminRole('SUPERADMIN')).toBe(true);
    expect(isAdminRole('PRO')).toBe(false);
    expect(isAdminRole('USER')).toBe(false);
    expect(isAdminRole('')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });

  it('identifies pro roles correctly', () => {
    expect(isProRole('PRO')).toBe(true);
    expect(isProRole('pro')).toBe(true);
    expect(isProRole('STRUCTURE_ADMIN')).toBe(true);
    expect(isProRole('structure_admin')).toBe(true);
    expect(isProRole('SUPERADMIN')).toBe(true); // superadmin can also act as pro
    expect(isProRole('admin')).toBe(false);
    expect(isProRole('USER')).toBe(false);
    expect(isProRole('')).toBe(false);
  });
});

describe('resolveAuthContext edge cases', () => {
  it('returns null when no authorization header is present', async () => {
    const auth = await resolveAuthContext({ headers: {} });
    expect(auth).toBeNull();
  });

  it('returns null for empty bearer token', async () => {
    const auth = await resolveAuthContext({ headers: { authorization: 'Bearer ' } });
    expect(auth).toBeNull();
  });

  it('returns null for non-Bearer auth scheme', async () => {
    const auth = await resolveAuthContext({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    expect(auth).toBeNull();
  });

  it('returns admin context for valid admin session JWT', async () => {
    const token = signAdminSessionToken({ email: 'admin@test.local', role: 'admin' });
    const auth = await resolveAuthContext({ headers: { authorization: `Bearer ${token}` } });
    expect(auth).not.toBeNull();
    expect(auth.role).toBe('admin');
  });

  it('returns pro context for valid pro JWT', async () => {
    const proToken = signProToken({
      id: 'pro-123',
      email: 'pro@test.local',
      role: 'PRO',
      structureId: 'struct-456',
    });
    const auth = await resolveAuthContext({ headers: { authorization: `Bearer ${proToken}` } });
    expect(auth).not.toBeNull();
    expect(auth.authType).toBe('pro_jwt');
    expect(auth.userId).toBe('pro-123');
  });
});
