import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    importLogCreate: vi.fn().mockResolvedValue({}),
    runIngestActualitesRss: vi.fn().mockResolvedValue({
      fetched: 0,
      processed: 0,
      created: 0,
      updated: 0,
      skippedExisting: 0,
      errors: [],
      durationByStage: { fetchMs: 0, processingMs: 0 },
    }),
  };
});

vi.mock('../../../src/db/index.js', () => {
  return {
    db: {
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue([{}]),
      })),
    },
  };
});

vi.mock('./ingest-actualites-rss.js', () => ({
  runIngestActualitesRss: mocks.runIngestActualitesRss,
}));

import handler from './pipeline.js';

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    url: 'http://localhost/api/cron/pipeline',
    headers: {},
    query: {},
    body: {},
    cookies: {},
    ...overrides,
  };
}

function mockRes() {
  return {
    statusCode: 200,
    getHeader: vi.fn(),
    setHeader: vi.fn(),
    set: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
}

describe('News Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('should unauthorized if no secret', async () => {
    const req = mockReq({
      url: 'http://localhost/api/cron/pipeline',
      headers: { get: () => null }
    });
    const resMock = mockRes();
    await handler(req, resMock);
    expect(resMock.status).toHaveBeenCalledWith(401);
  });

  it('should run pipeline successfully', async () => {
    mocks.runIngestActualitesRss.mockResolvedValueOnce({
      fetched: 1,
      processed: 1,
      created: 1,
      updated: 0,
      skippedExisting: 0,
      errors: [],
      durationByStage: { fetchMs: 10, processingMs: 5 },
    });

    const req = mockReq({
      // IMPORTANT: mettre source dans l'URL aussi pour new URL()
      url: 'http://localhost/api/cron/pipeline?source=actualites&mode=smoke&secret=test-secret',
      query: {
        source: 'actualites',
        mode: 'smoke',
        secret: 'test-secret'
      },
      headers: {
        get: (/** @type {string} */ name) => {
          if (name === 'authorization') return 'Bearer test-secret';
          return null;
        },
        authorization: 'Bearer test-secret',
        host: 'localhost'
      }
    });

    const resMock = mockRes();
    await handler(req, resMock);
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(mocks.runIngestActualitesRss).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, runId: expect.any(String) }),
    );
  });
});
