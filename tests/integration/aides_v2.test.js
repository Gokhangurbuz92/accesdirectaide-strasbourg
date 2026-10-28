import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../api/_handlers/aides.js';

// Mocks
vi.mock('../../src/db/index.js', () => ({
    db: {
        query: {
            Aide: {
                findFirst: vi.fn(),
                findMany: vi.fn(),
            }
        }
    }
}));

vi.mock('../../api/_utils/rateLimit.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1')
}));

vi.mock('../../api/lib/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock searchAides because it's complex logic we want to test separately (or we can test it integrated)
// The handler calls searchAides. Ideally we test the handler's ability to parse inputs and format outputs.
// So mocking searchAides is cleaner for handler integration.
vi.mock('../../api/lib/search-query.js', () => ({
    searchAides: vi.fn()
}));

import { searchAides } from '../../api/lib/search-query.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

describe('API /aides Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockRes = () => {
        const res = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    };

    it('should return 400 for invalid query params', async () => {
        const req = { method: 'GET', url: '/api/aides', query: { page: 'invalid' } };
        const res = mockRes();

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid parameters' }));
    });

    it('should return 200 and data for valid list request', async () => {
        const req = { method: 'GET', url: '/api/aides', query: { q: 'test', theme: 'logement' } };
        const res = mockRes();

        searchAides.mockResolvedValue({
            items: [{ id: '1', titre: 'Aide Test' }],
            total: 1,
            facets: { themes: { logement: 1 } }
        });

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            items: expect.any(Array),
            facets: expect.any(Object),
            pagination: expect.any(Object)
        }));
        expect(searchAides).toHaveBeenCalledWith(expect.objectContaining({
            q: 'test',
            theme: 'logement',
            statut: 'publie'
        }));
    });

    it('should return 200 for single item fetch (id)', async () => {
        const req = { method: 'GET', url: '/api/aides', query: { id: '123' } };
        const res = mockRes();

        db.query.Aide.findFirst.mockResolvedValue({ id: '123', titre: 'Detail', statut: 'publie' });

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: '123' }));
    });

    it('should return 404 if item not found or not published', async () => {
        const req = { method: 'GET', url: '/api/aides', query: { id: '999' } };
        const res = mockRes();

        db.query.Aide.findFirst.mockResolvedValue(null);

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });
});
