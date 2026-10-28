import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect } from 'vitest';
import aidesHandler from '../../api/_handlers/aides.js';

// Mock DB
const mockDb = vi.hoisted(() => ({
    query: {
        Aide: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
        }
    },
    select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue([{ count: 0 }])
    }),
}));

vi.mock('../../src/db/index.js', () => ({
    db: mockDb
}));

vi.mock('../../api/_utils/rateLimit.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1')
}));

vi.mock('../../api/lib/search-query.js', () => ({
    searchAides: vi.fn().mockResolvedValue({ items: [], total: 0 })
}));

describe('API HEAD Support', () => {
    it('should return 200 for HEAD request on /api/aides', async () => {
        mockDb.query.Aide.findFirst.mockResolvedValue({ id: 1, slug: 'aide-test', statut: 'publie' });

        const req = {
            method: 'HEAD',
            query: { slug: 'aide-test' },
            headers: {}
        };

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
            end: vi.fn()
        };

        await aidesHandler(req, res);

        // Should NOT call 405
        expect(res.status).not.toHaveBeenCalledWith(405);
        // Should call 200
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
