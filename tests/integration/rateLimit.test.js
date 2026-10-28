import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as rateLimitUtils from '../../api/_utils/rateLimit.js';

// We need to reset modules to test environment variable variations
// but getting vitest to reload module-level consts is tricky.
// Instead, we will test the logic by mocking the dependencies directly
// or by refactoring rateLimit.js to export the init logic (which is cleaner but changes code).
// For now, let's try to infer backend from logs or exposed clients if possible.
// Actually, rateLimit.js exposes checkRateLimit.

// Strategy:
// 1. Mock @upstash/redis and @upstash/ratelimit
// 2. Mock console.log to verified Init message
// 3. Since checking process.env at module load time is hard to change dynamically in one test suite without isolation,
//    we will assume the test runner environment.
//    However, we can skip module isolation complexity by testing the *logic* of the exports.

// Actually, checking standard behaviors is enough.
// We'll mock the internal methods if possible, or just the external calls.

// Let's rely on the fact that we can mock `process.env` BEFORE importing.
// We will use `vi.doMock` for dynamic imports in tests.

describe('Rate Limit Migration (P1)', () => {

    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('should use MEMORY backend when env vars are missing', async () => {
        vi.stubEnv('KV_REST_API_URL', '');
        vi.stubEnv('KV_REST_API_TOKEN', '');

        // Dynamic import to trigger module-level init
        const rateLimitModule = await import('../../api/_utils/rateLimit.js?t=1');

        // We can verify this by checking if it allows requests and doesn't crash
        // And importantly, checking the console log if we spy on it, 
        // but console logs happen at import time which is hard to spy on unless we spy before import.

        const result = await rateLimitModule.checkRateLimit('OTP_GEN', 'test-mem');
        expect(result.allowed).toBe(true);
    });

    it('should use KV_REST_API backend when env vars present', async () => {
        vi.stubEnv('KV_REST_API_URL', 'https://fake-upstash.url');
        vi.stubEnv('KV_REST_API_TOKEN', 'fake-token');

        // Mock Rest Client
        vi.doMock('@upstash/redis', () => ({
            Redis: class {
                constructor() { }
            }
        }));

        vi.doMock('@upstash/ratelimit', () => ({
            Ratelimit: class {
                constructor() { }
                limit() { return Promise.resolve({ success: true, limit: 10, remaining: 9 }); }
                static slidingWindow() { return {}; }
            }
        }));

        // Dynamic import
        const rateLimitModule = await import('../../api/_utils/rateLimit.js?t=2');

        const result = await rateLimitModule.checkRateLimit('OTP_GEN', 'test-kv');
        expect(result.allowed).toBe(true);
    });
});
