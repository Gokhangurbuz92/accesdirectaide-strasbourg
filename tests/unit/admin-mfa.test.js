import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * Admin MFA TOTP Shield — Unit Tests
 *
 * Tests:
 * 1. TOTP generation + vault encryption roundtrip
 * 2. TOTP verification with valid/invalid codes (async API)
 * 3. JWT mfa_verified claim presence/absence
 * 4. requireAdminMfa guard behavior
 * 5. otpauth:// URI generation
 */

// -------------------------------------------------------------------
// Test 1: TOTP + Vault Roundtrip
// -------------------------------------------------------------------
describe('Admin MFA — TOTP + Vault Roundtrip', () => {
    const TEST_KEY = crypto.randomBytes(32).toString('hex');

    beforeEach(() => {
        process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    });

    it('should generate a valid TOTP secret', async () => {
        const { generateSecret } = await import('otplib');
        const secret = generateSecret();
        expect(secret).toBeDefined();
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThanOrEqual(16);
    });

    it('should survive vault encrypt/decrypt roundtrip', async () => {
        const { generateSecret } = await import('otplib');
        const { encryptToken, decryptToken } = await import('../../api/_utils/vault.js');

        const secret = generateSecret();
        const encrypted = encryptToken(secret);

        expect(encrypted).toHaveProperty('content');
        expect(encrypted).toHaveProperty('iv');
        expect(encrypted.content).not.toBe(secret);

        const decrypted = decryptToken(encrypted.content, encrypted.iv);
        expect(decrypted).toBe(secret);
    });

    it('should generate and verify a TOTP code from decrypted secret', async () => {
        const { generateSecret, generate, verify } = await import('otplib');
        const { encryptToken, decryptToken } = await import('../../api/_utils/vault.js');

        const secret = generateSecret();
        const encrypted = encryptToken(secret);
        const recovered = decryptToken(encrypted.content, encrypted.iv);

        const code = await generate({ secret: recovered });
        expect(code).toMatch(/^\d{6}$/);

        const result = await verify({ token: code, secret: recovered });
        expect(result.valid).toBe(true);
    });

    it('should reject an invalid TOTP code', async () => {
        const { generateSecret, generate, verify } = await import('otplib');

        const secret = generateSecret();
        const validCode = await generate({ secret });
        const wrongCode = String((parseInt(validCode, 10) + 1) % 1000000).padStart(6, '0');

        const result = await verify({ token: wrongCode, secret });
        expect(result.valid).toBe(false);
    });

    it('should verify with 1-step time drift window', async () => {
        const { generateSecret, generate, verify } = await import('otplib');

        const secret = generateSecret();
        const code = await generate({ secret });

        const result = await verify({ token: code, secret, window: 1 });
        expect(result.valid).toBe(true);
    });
});

// -------------------------------------------------------------------
// Test 2: signAdminSessionToken — mfa_verified claim
// -------------------------------------------------------------------
describe('Admin MFA — JWT mfa_verified claim', () => {
    beforeEach(() => {
        process.env.AUTH_SECRET = 'test-secret-for-mfa-jwt-unit-test-32chars!!';
        process.env.AUTH_MODE = 'jwt';
    });

    it('should include mfa_verified: true in JWT when set', async () => {
        const { signAdminSessionToken, verifyAdminSessionToken } = await import('../../api/_utils/auth.js');

        const token = signAdminSessionToken({
            email: 'admin@test.fr',
            role: 'admin',
            mfa_verified: true,
        });
        expect(token).toBeDefined();

        const decoded = verifyAdminSessionToken(token);
        expect(decoded).toBeDefined();
        expect(decoded.mfa_verified).toBe(true);
        expect(decoded.scope).toBe('admin');
    });

    it('should include mfa_verified: false when not set', async () => {
        const { signAdminSessionToken, verifyAdminSessionToken } = await import('../../api/_utils/auth.js');

        const token = signAdminSessionToken({
            email: 'admin@test.fr',
            role: 'admin',
        });

        const decoded = verifyAdminSessionToken(token);
        expect(decoded).toBeDefined();
        expect(decoded.mfa_verified).toBe(false);
    });

    it('should reject truthy non-boolean as mfa_verified', async () => {
        const { signAdminSessionToken, verifyAdminSessionToken } = await import('../../api/_utils/auth.js');

        const token = signAdminSessionToken({
            email: 'admin@test.fr',
            role: 'admin',
            mfa_verified: 'yes',
        });

        const decoded = verifyAdminSessionToken(token);
        expect(decoded.mfa_verified).toBe(false);
    });
});

// -------------------------------------------------------------------
// Test 3: requireAdminMfa guard
// -------------------------------------------------------------------
describe('Admin MFA — requireAdminMfa guard', () => {
    beforeEach(() => {
        process.env.AUTH_SECRET = 'test-secret-for-mfa-jwt-unit-test-32chars!!';
        process.env.AUTH_MODE = 'jwt';
    });

    it('should block request without mfa_verified claim', async () => {
        const { signAdminSessionToken, requireAdminMfa } = await import('../../api/_utils/auth.js');

        const token = signAdminSessionToken({
            email: 'admin@test.fr',
            role: 'admin',
            mfa_verified: false,
        });

        const innerHandler = vi.fn((_req, res) => res.status(200).json({ ok: true }));
        const guarded = requireAdminMfa(innerHandler);

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn(),
        };

        await guarded(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfa_required: true }));
        expect(innerHandler).not.toHaveBeenCalled();
    });

    it('should allow request with mfa_verified: true claim', async () => {
        const { signAdminSessionToken, requireAdminMfa } = await import('../../api/_utils/auth.js');

        const token = signAdminSessionToken({
            email: 'admin@test.fr',
            role: 'admin',
            mfa_verified: true,
        });

        const innerHandler = vi.fn((_req, res) => res.status(200).json({ ok: true }));
        const guarded = requireAdminMfa(innerHandler);

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn(),
        };

        await guarded(req, res);
        expect(innerHandler).toHaveBeenCalled();
    });
});

// -------------------------------------------------------------------
// Test 4: otpauth:// URI format
// -------------------------------------------------------------------
describe('Admin MFA — otpauth URI generation', () => {
    it('should generate a valid otpauth:// provisioning URI', async () => {
        const { generateSecret, generateURI } = await import('otplib');
        const secret = generateSecret();
        const uri = generateURI({
            label: 'admin@test.fr',
            issuer: 'AccesDirectAide Admin',
            secret,
        });

        expect(uri).toMatch(/^otpauth:\/\/totp\//);
        expect(uri).toContain('AccesDirectAide');
        expect(uri).toContain('secret=');
    });
});
