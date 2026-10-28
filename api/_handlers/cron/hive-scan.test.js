/**
 * Hive Scan — Unit Tests (co-located)
 *
 * Tests feature flag, category scanning, recordMetric, CronRun log.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const insertValuesFn = vi.fn().mockResolvedValue([]);
  const insertFn = vi.fn(/** @type {(table: string) => { values: typeof insertValuesFn }} */ (() => ({ values: insertValuesFn })));
  return { db: { insert: insertFn }, insertFn, insertValuesFn, generateContent: vi.fn(), recordMetric: vi.fn() };
});

vi.mock('../../../src/db/index.js', () => ({ db: mocks.db }));
vi.mock('../../../src/db/schema.js', () => ({ ReviewQueueItem: 'ReviewQueueItem', CronRun: 'CronRun' }));
vi.mock('../../lib/gemini-metrics.js', () => ({ recordMetric: /**
 * @param {...unknown} a
 */
(...a) => mocks.recordMetric(...a) }));
vi.mock('../../lib/gemini-circuit-breaker.js', () => ({
  createGeminiBreaker: /**
   * @template Payload, Result
   * @param {(payload: Payload) => Promise<Result>} fn
   */ (fn) => ({ fire: /** @param {Payload} p */ async (p) => fn(p) }),
}));
vi.mock('../../_utils/logger.js', () => ({ default: { info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('../../_utils/cronAuth.js', () => ({
  getCronAuth: () => ({ ok: true }),
  scheduledByVercel: () => false,
  getHeader: /**
   * @param {{ headers?: Record<string, string> }} req
   * @param {string} name
   */ (req, name) => req.headers?.[name],
}));
vi.mock('../../_utils/env.js', () => ({
  env: { runtime: { vercelEnv: 'test', nodeEnv: 'test' }, ai: { geminiKey: 'test-key' }, kv: {} },
}));
vi.mock('../../lib/ai-policy.js', () => ({
  AIProviderPolicy: { evaluate: vi.fn(() => ({ allowed: true })) },
  PROVIDER: { GEMINI: 'gemini' },
  AUDIENCE: { PROFESSIONAL: 'professional' }
}));
vi.mock('@sentry/node', () => ({ captureMessage: () => {}, captureException: () => {} }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    constructor() {}
    getGenerativeModel() {
      return { generateContent: /**
       * @param {...unknown} a
       */
      (...a) => mocks.generateContent(...a) };
    }
  },
}));

import handler from './hive-scan.js';

function mockRes() {
  return { statusCode: 200, setHeader: vi.fn(), getHeader: vi.fn(), set: vi.fn(), writeHead: vi.fn(), end: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn(), redirect: vi.fn() };
}
function mockReq(o = {}) {
  return { method: 'GET', url: '/api/cron/hive-scan', headers: {}, query: {}, body: {}, cookies: {}, requestId: 'req-1', ...o };
}

describe('Hive Scan', () => {
  const O_FLAG = process.env.ENABLE_AI_AGENT;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_AI_AGENT = 'true';
    mocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify([{ title: 'Aide A', source: 'Gov', summary: 'Test' }]),
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      },
    });
  });
  afterEach(() => { process.env.ENABLE_AI_AGENT = O_FLAG; });

  // launch-readiness item 53: a disabled feature is not an outage — the run is skipped (200), nothing is called
  it('skips the run when ENABLE_AI_AGENT=false', async () => {
    process.env.ENABLE_AI_AGENT = 'false';
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, skipped: 'disabled', flag: 'ENABLE_AI_AGENT' }));
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('rejects PUT with 405', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PUT' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('scans all 12 categories', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const j = res.json.mock.calls[0][0];
    expect(j.ok).toBe(true);
    expect(j.totalFound).toBe(12); // 12 categories × 1 finding
    expect(j.perCategory).toHaveProperty('LOGEMENT');
    expect(j.perCategory).toHaveProperty('SANTE');
    expect(j.perCategory).toHaveProperty('EMPLOI');
    expect(j.perCategory).toHaveProperty('FAMILLE');
    expect(j.perCategory).toHaveProperty('HANDICAP');
    expect(j.perCategory).toHaveProperty('SENIORS');
  });

  it('calls recordMetric for each category', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(mocks.recordMetric).toHaveBeenCalledTimes(12);
    expect(mocks.recordMetric).toHaveBeenCalledWith(expect.objectContaining({ type: 'hive-scan', success: true }));
  });

  it('logs CronRun on success', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    const cronCalls = mocks.insertFn.mock.calls.filter(c => c[0] === 'CronRun');
    expect(cronCalls.length).toBe(1);
  });

  it('handles circuit breaker fallback', async () => {
    mocks.generateContent.mockResolvedValue({ fallback: true, message: 'open' });
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].totalFound).toBe(0);
  });

  it('sets response headers', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-1');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
