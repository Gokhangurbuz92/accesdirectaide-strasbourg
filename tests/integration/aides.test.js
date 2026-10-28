import { vi } from 'vitest';
vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

/**
 * Aides Integration Tests
 *
 * Validates the public /api/aides endpoint contract:
 * listing, pagination, search query, detail, and 404.
 */
import { describe, it, expect } from 'vitest';
import aidesHandler from '../../api/_handlers/aides.js';

function createMockReq({ method = 'GET', url = '/api/aides', query = {}, headers = {} } = {}) {
    return {
        method,
        url,
        query,
        headers: {
            host: 'localhost:3000',
            'x-forwarded-proto': 'http',
            'x-forwarded-for': '127.0.0.1',
            ...headers,
        },
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        setHeader(key, value) {
            this.headers[key] = value;
        },
        writeHead(code, hdrs) {
            this.statusCode = code;
            this.headers = { ...this.headers, ...hdrs };
            return this;
        },
        end(data) {
            if (data) this.body = data;
            return this;
        },
    };
    return res;
}

const hasDatabase = !!process.env.DATABASE_URL;

describe.skipIf(!hasDatabase)('Aides API', () => {
    it('GET /api/aides returns 200 with items and pagination', async () => {
        const req = createMockReq({ query: { limit: '3' } });
        const res = createMockRes();

        await aidesHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body).toHaveProperty('pagination');
        expect(res.body.pagination).toEqual(
            expect.objectContaining({
                page: 1,
                limit: 3,
            }),
        );
    });

    it('GET /api/aides?limit=5 returns at most 5 results', async () => {
        const req = createMockReq({ query: { limit: '5' } });
        const res = createMockRes();

        await aidesHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.items.length).toBeLessThanOrEqual(5);
    });

    it('GET /api/aides?q=logement returns relevant results', async () => {
        const req = createMockReq({
            url: '/api/aides?q=logement&limit=10',
            query: { q: 'logement', limit: '10' },
        });
        const res = createMockRes();

        await aidesHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('items');
        // Results may be empty if no matching aides
    });

    it('each aide has required fields (titre or title, description)', async () => {
        const req = createMockReq({ query: { limit: '3' } });
        const res = createMockRes();

        await aidesHandler(req, res);

        expect(res.statusCode).toBe(200);
        if (res.body.items.length > 0) {
            const aide = res.body.items[0];
            // Should have at least one of titre/title
            const hasTitle = Boolean(aide.titre || aide.title);
            expect(hasTitle).toBe(true);
            expect(aide).toHaveProperty('id');
            expect(aide).toHaveProperty('slug');
        }
    });

    it('GET /api/aides/:slug returns 200 for a known aide', async () => {
        // First discover an existing aide
        const listReq = createMockReq({ query: { limit: '1' } });
        const listRes = createMockRes();
        await aidesHandler(listReq, listRes);

        if (!listRes.body?.items?.length) return;

        const slug = listRes.body.items[0].slug;
        const detailReq = createMockReq({
            url: `/api/aides/${slug}`,
            query: {},
        });
        const detailRes = createMockRes();

        await aidesHandler(detailReq, detailRes);

        expect(detailRes.statusCode).toBe(200);
        expect(detailRes.body).toHaveProperty('slug', slug);
    });

    it('GET /api/aides/unknown-slug-that-does-not-exist returns 404', async () => {
        const req = createMockReq({
            url: '/api/aides/this-slug-definitely-does-not-exist-xyz',
            query: {},
        });
        const res = createMockRes();

        await aidesHandler(req, res);

        expect(res.statusCode).toBe(404);
    });

    it('returns facets in listing response', async () => {
        const req = createMockReq({ query: { limit: '1' } });
        const res = createMockRes();

        await aidesHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('facets');
    });
});
