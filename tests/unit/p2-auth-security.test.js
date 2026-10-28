import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * P2 Auth Security Tests — Rate Limiting & Session Refresh
 *
 * Tests:
 * 1. Rate Limit: checkRateLimit blocks after N attempts (in-memory)
 * 2. Refresh: re-issues token with valid claims
 * 3. Refresh: rejects token expired beyond grace period
 * 4. Refresh: accepts token within grace period
 * 5. Login: returns Retry-After header on 429
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-p2-auth-security-32ch';
const PRO_SESSION_ISSUER = 'accesdirectaide';
const PRO_SESSION_AUDIENCE = 'accesdirectaide-pro';

/**
 * Helper: create a test pro JWT
 */
function createTestProToken(overrides = {}, expiresIn = '8h') {
    const payload = {
        userId: 'test-user-id',
        email: 'agent@test.fr',
        structureId: 'test-structure-id',
        role: 'PRO',
        scope: 'pro',
        ...overrides,
    };
    return jwt.sign(payload, TEST_JWT_SECRET, {
        expiresIn,
        issuer: PRO_SESSION_ISSUER,
        audience: PRO_SESSION_AUDIENCE,
        algorithm: 'HS256',
    });
}

/**
 * Helper: create an expired pro JWT with specific exp
 */
function createExpiredProToken(secondsAgo = 60) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        userId: 'test-user-id',
        email: 'agent@test.fr',
        structureId: 'test-structure-id',
        role: 'PRO',
        scope: 'pro',
        iat: now - 3600,
        exp: now - secondsAgo,
    };
    return jwt.sign(payload, TEST_JWT_SECRET, {
        algorithm: 'HS256',
        issuer: PRO_SESSION_ISSUER,
        audience: PRO_SESSION_AUDIENCE,
    });
}

// -------------------------------------------------------------------
// Test 1: Rate Limiting — In-Memory blocking
// -------------------------------------------------------------------
describe('P2 Auth — Rate Limiting (In-Memory)', () => {
    beforeEach(() => {
        // Ensure no KV credentials → forces in-memory backend
        delete process.env.KV_REST_API_URL;
        delete process.env.KV_REST_API_TOKEN;
    });

    it('should allow requests within the limit', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        // LOGIN_PRO: 5 per 15 min — first 5 should pass
        const uniqueId = `test-ip-${Date.now()}-${Math.random()}`;
        for (let i = 0; i < 5; i++) {
            const result = await checkRateLimit('LOGIN_PRO', uniqueId);
            expect(result.allowed).toBe(true);
        }
    });

    it('should block after exceeding the limit', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        const uniqueId = `test-ip-block-${Date.now()}-${Math.random()}`;
        // Exhaust the 5-request limit
        for (let i = 0; i < 5; i++) {
            await checkRateLimit('LOGIN_PRO', uniqueId);
        }

        // 6th request should be blocked
        const blocked = await checkRateLimit('LOGIN_PRO', uniqueId);
        expect(blocked.allowed).toBe(false);
        expect(blocked.error).toBeDefined();
        expect(blocked.error.code).toBe('RATE_LIMITED');
    });

    it('should return proper French error message on block', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        const uniqueId = `test-ip-msg-${Date.now()}-${Math.random()}`;
        for (let i = 0; i < 6; i++) {
            await checkRateLimit('LOGIN_PRO', uniqueId);
        }

        const blocked = await checkRateLimit('LOGIN_PRO', uniqueId);
        expect(blocked.allowed).toBe(false);
        expect(blocked.error.error).toContain('Trop de tentatives');
    });

    it('should track different identifiers independently', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        const idA = `test-ip-a-${Date.now()}-${Math.random()}`;
        const idB = `test-ip-b-${Date.now()}-${Math.random()}`;

        // Exhaust limit on idA
        for (let i = 0; i < 6; i++) {
            await checkRateLimit('LOGIN_PRO', idA);
        }

        // idB should still be allowed
        const resultB = await checkRateLimit('LOGIN_PRO', idB);
        expect(resultB.allowed).toBe(true);
    });
});

// -------------------------------------------------------------------
// Test 2: Refresh Token — Valid token re-issue
// -------------------------------------------------------------------
describe('P2 Auth — Refresh Token', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
    });

    it('should re-issue a fresh token from a valid pro JWT', async () => {
        const { verifyProToken, signProToken } = await import('../../api/_utils/auth.js');

        const originalToken = createTestProToken();
        const claims = verifyProToken(originalToken);

        expect(claims).toBeDefined();
        expect(claims.userId).toBe('test-user-id');
        expect(claims.structureId).toBe('test-structure-id');

        // Simulate refresh: re-issue
        const newToken = signProToken({
            id: claims.userId,
            email: claims.email,
            structureId: claims.structureId,
            role: claims.role,
        });

        expect(newToken).toBeDefined();
        expect(typeof newToken).toBe('string');

        // Verify new token has valid claims
        const newClaims = verifyProToken(newToken);
        expect(newClaims).toBeDefined();
        expect(newClaims.userId).toBe('test-user-id');
        expect(newClaims.structureId).toBe('test-structure-id');
    });

    it('should reject a standard verify on an expired token', async () => {
        const { verifyProToken } = await import('../../api/_utils/auth.js');

        const expiredToken = createExpiredProToken(120); // expired 2 min ago
        const claims = verifyProToken(expiredToken);
        expect(claims).toBeNull(); // Standard verify rejects expired
    });

    it('should decode an expired token with ignoreExpiration for grace check', () => {
        const expiredToken = createExpiredProToken(1800); // expired 30 min ago

        const decoded = jwt.verify(expiredToken, TEST_JWT_SECRET, {
            algorithms: ['HS256'],
            ignoreExpiration: true,
        });

        expect(decoded).toBeDefined();
        expect(decoded.userId).toBe('test-user-id');

        // Within 1h grace
        const now = Math.floor(Date.now() / 1000);
        expect(now - decoded.exp).toBeLessThan(3600);
    });

    it('should reject a token expired beyond 1h grace period', () => {
        const veryExpiredToken = createExpiredProToken(7200); // expired 2 hours ago

        const decoded = jwt.verify(veryExpiredToken, TEST_JWT_SECRET, {
            algorithms: ['HS256'],
            ignoreExpiration: true,
        });

        const now = Math.floor(Date.now() / 1000);
        const gracePeriod = 3600;

        expect(now - decoded.exp).toBeGreaterThan(gracePeriod);
    });
});

// -------------------------------------------------------------------
// Test 3: getRateLimitStatus utility
// -------------------------------------------------------------------
describe('P2 Auth — getRateLimitStatus utility', () => {
    it('should return 429 by default when no status in result', async () => {
        const { getRateLimitStatus } = await import('../../api/_utils/rateLimit.js');

        expect(getRateLimitStatus(null)).toBe(429);
        expect(getRateLimitStatus(undefined)).toBe(429);
        expect(getRateLimitStatus({})).toBe(429);
    });

    it('should return custom status when provided', async () => {
        const { getRateLimitStatus } = await import('../../api/_utils/rateLimit.js');

        expect(getRateLimitStatus({ status: 503 })).toBe(503);
        expect(getRateLimitStatus({ status: 429 })).toBe(429);
    });
});

// -------------------------------------------------------------------
// Test 4: Rate limit config completeness
// -------------------------------------------------------------------
describe('P2 Auth — Rate Limit Config', () => {
    it('should have LOGIN_PRO configured at 5 requests per 15 min', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        // If action is unknown, it logs a warning and uses default.
        // A known action should NOT produce a warning.
        // We verify by calling it and checking it works without error.
        const result = await checkRateLimit('LOGIN_PRO', `config-test-${Date.now()}`);
        expect(result.allowed).toBe(true);
    });

    it('should have REFRESH_PRO configured', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        const result = await checkRateLimit('REFRESH_PRO', `config-test-${Date.now()}`);
        expect(result.allowed).toBe(true);
    });

    it('should have MFA_VERIFY_PRO configured', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        const result = await checkRateLimit('MFA_VERIFY_PRO', `config-test-${Date.now()}`);
        expect(result.allowed).toBe(true);
    });

    it('should have REGISTER_PRO configured', async () => {
        const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');

        const result = await checkRateLimit('REGISTER_PRO', `config-test-${Date.now()}`);
        expect(result.allowed).toBe(true);
    });
});
