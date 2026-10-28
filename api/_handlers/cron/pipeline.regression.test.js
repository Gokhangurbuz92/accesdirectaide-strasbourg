import { vi, describe, it, expect, beforeEach } from 'vitest';
import handler from './pipeline.js';
import * as ingestStructures from './ingest-structures.js';
import { getCronAuth } from '../../_utils/cronAuth.js';

// Mock Dependencies
vi.mock('../../_utils/cronAuth.js');
vi.mock('./ingest-structures.js');
vi.mock('./ingest-aids.js');
vi.mock('../../../src/db/index.js', () => {
    return {
        db: {
            insert: vi.fn(() => ({
                values: vi.fn().mockResolvedValue([{}]),
            })),
            query: {
                RssSource: { findMany: vi.fn().mockResolvedValue([]) },
            },
        }
    };
});

function makePipelineRequest() {
    return {
        method: 'GET',
        url: '/api/cron/pipeline',
        query: { source: 'structures', mode: 'smoke' },
        headers: {},
        body: {},
        cookies: {}
    };
}

function makePipelineResponse() {
    return {
        statusCode: 200,
        getHeader: vi.fn(),
        setHeader: vi.fn(),
        set: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        send: vi.fn(),
        redirect: vi.fn()
    };
}

describe('Pipeline Regression Test (P0)', () => {
    /** @type {ReturnType<typeof makePipelineRequest>} */
    let req;
    /** @type {ReturnType<typeof makePipelineResponse>} */
    let res;

    beforeEach(() => {
        vi.resetAllMocks();
        // Default authorized
        vi.mocked(getCronAuth).mockReturnValue({ ok: true });

        req = makePipelineRequest();

        res = makePipelineResponse();
    });

    it('should return 502 when fetchMs=0 and errors=[] (Silent Failure Contract)', async () => {
        // Mock Ingester returning "Empty/No-Op" result
        vi.mocked(ingestStructures.runIngestStructures).mockResolvedValue({
            fetched: 0,
            processed: 0,
            created: 0,
            updated: 0,
            skippedExisting: 0,
            errors: [],
            durationByStage: {
                fetchMs: 0,     // <--- The Trigger
                processingMs: 0
            }
        });

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(502);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            ok: false,
            error: expect.stringContaining('PIPELINE_NOOP')
        }));
    });

    it('should return 200 and stats.ingested when execution is valid', async () => {
        // Mock Ingester returning Valid Result
        vi.mocked(ingestStructures.runIngestStructures).mockResolvedValue({
            fetched: 5,
            processed: 5,
            created: 2,
            updated: 3,
            skippedExisting: 0,
            errors: [],
            durationByStage: {
                fetchMs: 150,
                processingMs: 50
            }
        });

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const json = res.json.mock.calls[0][0];

        expect(json.ok).toBe(true);
        expect(json.stats.durationByStage.fetchMs).toBe(150);
        // Requirement: stats.ingested != null (mapped from created)
        expect(json.stats.ingested).toBe(2);
    });
});
