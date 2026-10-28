import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach } from 'vitest';

// --- Mock Prisma ---
const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockFindFirst = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock('../../api/_utils/prisma.js', () => ({
    default: {
        aide: {
            findMany: (...args) => mockFindMany(...args),
            count: (...args) => mockCount(...args),
            findFirst: (...args) => mockFindFirst(...args),
        },
        $queryRaw: (...args) => mockQueryRaw(...args),
    },
}));

const mockDrizzleFindMany = vi.fn();
const mockDrizzleSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
        where: vi.fn()
    })
});

vi.mock('../../src/db/index.js', () => ({
    db: {
        query: {
            Aide: {
                findFirst: (...args) => mockFindFirst(...args),
                findMany: (...args) => mockDrizzleFindMany(...args)
            }
        },
        select: (...args) => mockDrizzleSelect(...args)
    }
}));

vi.mock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        count: vi.fn().mockReturnValue('count_mock')
    };
});

vi.mock('../../api/_utils/rateLimit.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../api/lib/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// --- Mock response ---
function createMockRes() {
    const res = {
        statusCode: 200,
        _json: null,
        status(code) { res.statusCode = code; return res; },
        json(data) { res._json = data; return res; },
    };
    return res;
}

// =====================
// /api/drees
// =====================
describe('/api/drees handler', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Dynamic import to get fresh module with mocks
        const mod = await import('../../api/_handlers/drees.js');
        handler = mod.default;
    });

    it('returns 200 with stable JSON shape on success', async () => {
        const items = [{ id: '1', slug: 'apa', titre: 'APA', updatedAt: new Date() }];
        mockFindMany.mockResolvedValue(items);
        mockCount.mockResolvedValue(1);

        const req = { method: 'GET', query: { page: '1', limit: '1' }, headers: {} };
        const res = createMockRes();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res._json).toHaveProperty('items');
        expect(res._json).toHaveProperty('pagination');
        expect(res._json.pagination).toHaveProperty('total');
        expect(res._json.pagination).toHaveProperty('page');
        expect(res._json.pagination).toHaveProperty('limit');
        expect(res._json.pagination).toHaveProperty('totalPages');
        expect(res._json.pagination).toHaveProperty('hasNext');
    });

    it('returns 200 with empty items when DB fails completely', async () => {
        mockFindMany.mockRejectedValue(new Error('Connection refused'));
        mockCount.mockRejectedValue(new Error('Connection refused'));

        const req = { method: 'GET', query: { page: '1', limit: '1' }, headers: {} };
        const res = createMockRes();

        await handler(req, res);

        // Must NOT be 500
        expect(res.statusCode).toBe(200);
        expect(res._json.items).toEqual([]);
        expect(res._json.pagination.total).toBe(0);
        expect(res._json._error).toBe('database_unavailable');
    });

    it('returns 405 for non-GET methods', async () => {
        const req = { method: 'POST', query: {}, headers: {} };
        const res = createMockRes();

        await handler(req, res);

        expect(res.statusCode).toBe(405);
    });
});

// =====================
// /api/aids (aides)
// =====================
describe('/api/aids handler', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Need to also mock sentry and validators
        vi.doMock('@sentry/node', () => ({
            default: { addBreadcrumb: vi.fn(), captureException: vi.fn() },
            addBreadcrumb: vi.fn(),
            captureException: vi.fn(),
        }));

        vi.doMock('../../api/_utils/validators.js', () => ({
            searchAidesSchema: {
                safeParse: (input) => ({
                    success: true,
                    data: {
                        page: Number(input.page) || 1,
                        pageSize: Number(input.limit) || 20,
                        q: input.q || undefined,
                        sort: input.sort || undefined,
                    },
                }),
            },
        }));

        vi.doMock('../../api/lib/search-query.js', () => ({
            searchAides: vi.fn().mockRejectedValue(new Error('column "search_vector" does not exist')),
        }));

        vi.doMock('../../api/_utils/provenance.js', () => ({
            buildProvenance: vi.fn().mockReturnValue({}),
        }));

        const mod = await import('../../api/_handlers/aides.js');
        handler = mod.default;
    });

    it('falls back to simple query when searchAides fails and returns 200', async () => {
        const fallbackItems = [{ id: '1', slug: 'rsa', titre: 'RSA', updatedAt: new Date(), statut: 'publie' }];
        mockDrizzleFindMany.mockResolvedValue(fallbackItems);
        mockDrizzleSelect.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ value: 1 }])
            })
        });

        const req = { method: 'GET', query: { page: '1', limit: '1' }, headers: {}, url: '/api/aids?page=1&limit=1' };
        const res = createMockRes();

        await handler(req, res);

        // Must NOT be 500
        expect(res.statusCode).toBe(200);
        expect(res._json).toHaveProperty('items');
        expect(res._json).toHaveProperty('pagination');
        // Fallback flag should be set
        expect(res._json._fallback).toBe(true);
    });

    it('returns 503 with database_unavailable when even fallback fails', async () => {
        mockDrizzleFindMany.mockRejectedValue(new Error('Connection refused'));
        mockDrizzleSelect.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockRejectedValue(new Error('Connection refused'))
            })
        });

        const req = { method: 'GET', query: { page: '1', limit: '1' }, headers: {}, url: '/api/aids?page=1&limit=1' };
        const res = createMockRes();

        await handler(req, res);

        expect(res.statusCode).toBe(503);
        expect(res._json.items).toEqual([]);
        expect(res._json._error).toBe('database_unavailable');
    });
});
