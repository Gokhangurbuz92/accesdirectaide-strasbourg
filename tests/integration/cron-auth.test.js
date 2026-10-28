import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isCronAuthorized } from '../../api/_utils/cronAuth.js';

describe('Cron Authorization (P1D)', () => {
    const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

    beforeAll(() => {
        process.env.CRON_SECRET = 'test-cron-secret';
    });

    afterAll(() => {
        process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    });

    it('should ACCEPT valid Bearer token', () => {
            const req = {
                headers: {
                authorization: 'Bearer test-cron-secret'
                },
                query: {}
            };
        expect(isCronAuthorized(req)).toBe(true);
    });

    it('should ACCEPT valid query param secret', () => {
        const req = {
            headers: {},
            query: {
                secret: 'test-cron-secret'
            }
        };
        expect(isCronAuthorized(req)).toBe(true);
    });

    it('should ACCEPT valid x-cron-secret header', () => {
        const req = {
            headers: {
                'x-cron-secret': 'test-cron-secret',
            },
            query: {}
        };
        expect(isCronAuthorized(req)).toBe(true);
    });

    it('should REJECT x-vercel-cron header (must require secret)', () => {
        const req = {
            headers: {
                'x-vercel-cron': '1'
            },
            query: {}
        };
        expect(isCronAuthorized(req)).toBe(false);
    });

    it('should REJECT invalid Bearer token', () => {
        const req = {
            headers: {
                authorization: 'Bearer wrong-secret'
            },
            query: {}
        };
        expect(isCronAuthorized(req)).toBe(false);
    });

    it('should REJECT invalid query param secret', () => {
        const req = {
            headers: {},
            query: {
                secret: 'wrong-secret'
            }
        };
        expect(isCronAuthorized(req)).toBe(false);
    });

    it('should REJECT missing credentials', () => {
        const req = {
            headers: {},
            query: {}
        };
        expect(isCronAuthorized(req)).toBe(false);
    });

    it('should REJECT empty Bearer token', () => {
        const req = {
            headers: {
                authorization: 'Bearer '
            },
            query: {}
        };
        expect(isCronAuthorized(req)).toBe(false);
    });

    it('should REJECT malformed Authorization header', () => {
        const req = {
            headers: {
                authorization: 'test-cron-secret'
            },
            query: {}
        };
        expect(isCronAuthorized(req)).toBe(false);
    });
});
