import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, inArray, and, or, sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// 1. Define Hoisted Mocks
const { mockFindFirst, mockFindMany, mockCountFn } = vi.hoisted(() => {
    const mockCountFn = vi.fn().mockResolvedValue([{ count: 0 }]);
    return {
        mockFindFirst: vi.fn(),
        mockFindMany: vi.fn(),
        mockCountFn
    };
});

// 2. Mock Drizzle
vi.mock('../../src/db/index.js', () => {
    return {
        db: {
            query: {
                ResourceAccessibility: {
                    findFirst: mockFindFirst,
                    findMany: mockFindMany
                }
            },
            select: vi.fn(() => ({
                from: vi.fn(() => ({
                    where: mockCountFn, // Assuming it uses where
                    ...mockCountFn // Fallback if no where
                }))
            }))
        }
    };
});

// 3. Mock Rate Limit
vi.mock('../../api/_utils/rateLimit.js', () => {
    return {
        checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
        getClientIp: vi.fn().mockReturnValue('127.0.0.1')
    };
});

import handler from '../../api/_handlers/ressources.js';

describe('Ressources API Handler', () => {
    let mockReq;
    let mockRes;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mock returns
        mockFindMany.mockResolvedValue([]);
        mockCountFn.mockResolvedValue([{ count: 0 }]);
        mockFindFirst.mockResolvedValue(null);

        // Mock response object
        mockRes = {
            status: vi.fn(function(code) {
                this.statusCode = code;
                return this;
            }),
            json: vi.fn(function(data) {
                this.body = data;
                return this;
            }),
            statusCode: 200,
            body: null
        };
    });

    it('should return 405 for non-GET requests', async () => {
        mockReq = {
            method: 'POST',
            query: {},
            headers: {}
        };

        await handler(mockReq, mockRes);
        expect(mockRes.statusCode).toBe(405);
        expect(mockRes.body.error).toBe('Method not allowed');
    });

    it('should return 400 for invalid parameters', async () => {
        mockReq = {
            method: 'GET',
            query: { page: 'invalid' },
            headers: {}
        };

        await handler(mockReq, mockRes);
        expect(mockRes.statusCode).toBe(400);
        expect(mockRes.body.error).toBe('Invalid parameters');
    });

    it('should handle list requests with pagination', async () => {
        mockReq = {
            method: 'GET',
            query: { page: '1', pageSize: '10' },
            headers: {}
        };

        // Mock data
        mockFindMany.mockResolvedValue([{ id: 'res-1', slug: 'res-1' }]);
        mockCountFn.mockResolvedValue([{ count: 1 }]);

        await handler(mockReq, mockRes);
        
        // Should return 200
        expect(mockRes.statusCode).toBe(200);
        expect(mockRes.body).toHaveProperty('items');
        expect(mockRes.body.items).toHaveLength(1);
        expect(mockRes.body.pagination.total).toBe(1);
    });

    it('should handle single item requests by slug', async () => {
        mockReq = {
            method: 'GET',
            query: { slug: 'test-ressource' },
            headers: {}
        };

        // Mock Found
        mockFindFirst.mockResolvedValue({ id: 'res-1', slug: 'test-ressource', status: 'published' });

        await handler(mockReq, mockRes);
        
        expect(mockRes.statusCode).toBe(200);
        expect(mockRes.body.slug).toBe('test-ressource');
    });

    it('should return 404 for unknown slug', async () => {
        mockReq = {
            method: 'GET',
            query: { slug: 'unknown' },
            headers: {}
        };

        mockFindFirst.mockResolvedValue(null);

        await handler(mockReq, mockRes);
        expect(mockRes.statusCode).toBe(404);
    });

    it('should handle HEAD requests', async () => {
        mockReq = {
            method: 'HEAD',
            query: {},
            headers: {}
        };

        await handler(mockReq, mockRes);
        
        // Should not error on HEAD
        expect(mockRes.statusCode).toBe(200);
    });
});
