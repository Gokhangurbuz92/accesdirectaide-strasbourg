import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import '../../src/db/index.js';
import { describe, it, expect, beforeEach } from 'vitest';

// 1. Define Hoisted Mocks — C12: the handler reads through db.select() (single: …where().limit(); list: …where().orderBy().limit()); a double without
// execute() is taken as a database with migration 0050 (api/_utils/schema-features.js)
const { mockRows } = vi.hoisted(() => ({ mockRows: vi.fn() }));

// 2. Mock Drizzle
vi.mock('../../src/db/index.js', () => {
    const chain = () => { const c = { from: () => c, where: () => c, orderBy: () => c, limit: () => Promise.resolve(mockRows()) }; return c; };
    return { db: { select: vi.fn(() => chain()) } };
});

// 3. Mock Rate Limit
vi.mock('../../api/_utils/rateLimit.js', () => {
    return {
        checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
        getClientIp: vi.fn().mockReturnValue('127.0.0.1')
    };
});

import handler from '../../api/_handlers/ressources.js';
import { contentVersion } from '../../api/_services/resource-publication.js';

const BASE = { id: 'res-1', slug: 'res-1', title: 'Guide officiel', type: 'guide', content: 'Présentation officielle du service.', source_url: 'https://www.caf.fr/x',
    source_publisher: 'Caf', territory_scope: null, status: 'published', reviewer_type: 'admin', reviewer_id: 'admin@example.test', verified_at: new Date(Date.now() - 5 * 86400000) };
const PUBLISHED = { ...BASE, verified_version: contentVersion(BASE) };

describe('Ressources API Handler', () => {
    let mockReq;
    let mockRes;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mock returns
        mockRows.mockReturnValue([]);

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

        // Mock data: one document meeting the C12 contract, one legacy row « published » before 0050 (never public)
        mockRows.mockReturnValue([PUBLISHED, { id: 'old', slug: 'old', title: 'Ancien', type: 'guide', status: 'published', source_url: 'https://www.caf.fr/x' }]);

        await handler(mockReq, mockRes);
        
        // Should return 200
        expect(mockRes.statusCode).toBe(200);
        expect(mockRes.body).toHaveProperty('items');
        expect(mockRes.body.items).toHaveLength(1);
        expect(mockRes.body.items[0]).toMatchObject({ id: 'res-1', source_publisher: 'Caf', freshness: 'current' });
        expect(mockRes.body.items[0]).not.toHaveProperty('reviewer_id');
        expect(mockRes.body.pagination.total).toBe(1);
    });

    it('should handle single item requests by slug', async () => {
        mockReq = {
            method: 'GET',
            query: { slug: 'test-ressource' },
            headers: {}
        };

        // Mock Found
        mockRows.mockReturnValue([{ ...PUBLISHED, slug: 'test-ressource' }]);

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

        mockRows.mockReturnValue([]);

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
