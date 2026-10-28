import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect, beforeEach } from 'vitest';
import pipelineHandler from '../../api/_handlers/cron/pipeline.js';
import { runIngestStructures } from '../../api/_handlers/cron/ingest-structures.js';
import { runIngestAids } from '../../api/_handlers/cron/ingest-aids.js';

// Mock dependencies
vi.mock('../../api/_handlers/cron/ingest-structures.js', () => ({
    runIngestStructures: vi.fn().mockResolvedValue({ 
        fetched: 10, 
        processed: 10, 
        created: 10, 
        errors: [], 
        durationByStage: { fetchMs: 100, processingMs: 50 } 
    }),
    default: vi.fn()
}));
vi.mock('../../api/_handlers/cron/ingest-aids.js', () => ({
    runIngestAids: vi.fn().mockResolvedValue({ 
        fetched: 5, 
        processed: 5, 
        created: 5, 
        errors: [], 
        durationByStage: { fetchMs: 80, processingMs: 30 } 
    }),
    default: vi.fn()
}));
// Mock DB
const mockDb = vi.hoisted(() => ({
    query: {
        RssSource: {
            findMany: vi.fn().mockResolvedValue([]),
        }
    },
    insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn()
        })
    })
}));

vi.mock('../../src/db/index.js', () => ({
    db: mockDb
}));

// Setup req/res mocks
const createMocks = (query = {}, headers = {}) => {
    const req = {
        query,
        headers: { host: 'localhost', ...headers },
        url: '/api/cron/pipeline'
    };
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
    };
    return { req, res };
};

describe('Cron Pipeline Routing', () => {
    const CRON_SECRET = 'test_secret';

    beforeEach(() => {
        process.env.CRON_SECRET = CRON_SECRET;
        vi.clearAllMocks();
    });

    it('should return 401 if unauthorized', async () => {
        const { req, res } = createMocks({});
        await pipelineHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should authorize via Bearer token', async () => {
        const { req, res } = createMocks({ source: 'structures' }, { authorization: `Bearer ${CRON_SECRET}` });

        await pipelineHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(runIngestStructures).toHaveBeenCalled();
    });

    it('should authorize via query param', async () => {
        const { req, res } = createMocks({ source: 'structures', secret: CRON_SECRET });

        await pipelineHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 if source is missing', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET });
        await pipelineHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Missing required 'source'") }));
    });

    it('should route to structures when source=structures', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET, source: 'structures' });

        await pipelineHandler(req, res);

        expect(runIngestStructures).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'structures', ok: true }));
    });

    it('should pass limiting params when mode=smoke', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET, source: 'structures', mode: 'smoke' });

        await pipelineHandler(req, res);

        // Check if limit was passed
        // pipeline logic: if mode=smoke, limit=5
        expect(runIngestStructures).toHaveBeenCalledWith(expect.objectContaining({
            limit: 5,
            runId: expect.any(String)
        }));
    });

    it('should support aliases: demarches -> aides', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET, source: 'demarches' });

        await pipelineHandler(req, res);

        expect(runIngestAids).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            source: 'demarches',
            sourceResolved: 'aides',
            ok: true
        }));
    });

    it('should return rich stats structure', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET, source: 'structures' });

        await pipelineHandler(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            stats: expect.objectContaining({
                fetched: expect.any(Number),
                processed: expect.any(Number),
                created: expect.any(Number),
                skippedExisting: expect.any(Number),
                durationByStage: expect.any(Object)
            })
        }));
    });


    it('should return 400 for invalid source', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET, source: 'invalid' });

        await pipelineHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("Invalid source") }));
    });

    it('should report errors if ingester returns errors (Anti Silent Failure)', async () => {
        const { req, res } = createMocks({ secret: CRON_SECRET, source: 'structures' });

        // Mock returning an error
        runIngestStructures.mockResolvedValueOnce({
            fetched: 0,
            processed: 0,
            errors: ['[STRUCTURES] 0 items found'],
            durationByStage: { fetchMs: 100 }
        });

        await pipelineHandler(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            stats: expect.objectContaining({
                errors: expect.arrayContaining(['[STRUCTURES] 0 items found'])
            })
        }));
    });
});
