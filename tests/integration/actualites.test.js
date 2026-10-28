import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach } from 'vitest';
import actualitesHandler from '../../api/_handlers/actualites.js';

// Mock Auth
vi.mock('../../api/_utils/auth.js', () => ({
    verifyAdmin: vi.fn().mockReturnValue(false),
    getAuthenticatedUser: vi.fn(),
}));

// Mock CRUD
vi.mock('../../api/_utils/crud.js', () => ({
    handleAdminCreate: vi.fn(),
    handleAdminUpdate: vi.fn(),
    handleAdminDelete: vi.fn(),
}));

// Mock DB
const mockDb = vi.hoisted(() => ({
    query: {
        Actualite: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
        }
    },
    select: vi.fn().mockImplementation(() => {
        const fromFn = vi.fn().mockReturnThis();
        const whereFn = vi.fn().mockResolvedValue([{ count: 0 }]);
        return { from: fromFn, where: whereFn };
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
    db: mockDb
}));

describe('Actualites API Handler', () => {
    let req, res;

    beforeEach(() => {
        vi.clearAllMocks();
        req = {
            method: 'GET',
            query: {},
            body: {},
            headers: {}
        };
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn(),
            headersSent: false
        };
    });

    it('should return 200 with items on success', async () => {
        const fromFn = vi.fn().mockReturnThis();
        const whereFn = vi.fn().mockResolvedValue([{ count: 1 }]);
        mockDb.select.mockReturnValue({ from: fromFn, where: whereFn });
        mockDb.query.Actualite.findMany.mockResolvedValue([{ id: '1', titre: 'News' }]);

        await actualitesHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            items: [
              expect.objectContaining({
                id: '1',
                titre: 'News',
                provenance: expect.objectContaining({
                  verifiedAt: null,
                  fetchedAt: null,
                  sourceUrl: null,
                  sourceHost: null,
                }),
              }),
            ],
            pagination: expect.objectContaining({ page: 1 }),
          }),
        );
    });

    it('should fall back to empty list on DB error (Resilience)', async () => {
        // Simulate DB crash
        const fromFn = vi.fn().mockReturnThis();
        const whereFn = vi.fn().mockRejectedValue(new Error('DB Connection Failed'));
        mockDb.select.mockReturnValue({ from: fromFn, where: whereFn });
        mockDb.query.Actualite.findMany.mockRejectedValue(new Error('DB Connection Failed'));

        await actualitesHandler(req, res);

        // Expect 200 OK and empty envelope
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            items: [],
            pagination: expect.any(Object),
          }),
        );
    });

    it('should handle HEAD request as GET to avoid 401', async () => {
        req.method = 'HEAD';
        const fromFn = vi.fn().mockReturnThis();
        const whereFn = vi.fn().mockResolvedValue([{ count: 0 }]);
        mockDb.select.mockReturnValue({ from: fromFn, where: whereFn });
        mockDb.query.Actualite.findMany.mockResolvedValue([]);

        await actualitesHandler(req, res);

        // Should NOT be 401
        expect(res.status).not.toHaveBeenCalledWith(401);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
