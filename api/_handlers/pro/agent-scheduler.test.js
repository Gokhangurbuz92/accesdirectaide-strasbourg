/**
 * Agent Scheduler — Unit Tests (co-located)
 *
 * Critical test: ALL discoveries go to review queue (NO auto-validation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const insertValuesFn = vi.fn().mockResolvedValue([]);
  const insertFn = vi.fn(() => ({ values: insertValuesFn }));
  return { db: { insert: insertFn }, insertFn, insertValuesFn, generateContent: vi.fn(), recordMetric: vi.fn() };
});

vi.mock('../../../src/db/index.js', () => ({ db: mocks.db }));
vi.mock('../../../src/db/schema.js', () => ({ ReviewQueueItem: 'ReviewQueueItem', AuditLog: 'AuditLog' }));
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
vi.mock('../../_utils/auth.js', () => ({ requireProAuth: /** @template Handler @param {Handler} h */ (h) => h }));
vi.mock('../../lib/ai-policy.js', () => ({
  AIProviderPolicy: { evaluate: vi.fn(() => ({ allowed: true })) },
  PROVIDER: { GEMINI: 'gemini', OLLAMA: 'ollama' },
  AUDIENCE: { PROFESSIONAL: 'professional' },
}));
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

import handler from './agent-scheduler.js';

function mockRes() {
  return { setHeader: vi.fn(), getHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
function mockReq(o = {}) {
  return { method: 'POST', headers: {}, body: { poleId: 'pole-1', categoryId: 'Logement' }, user: { userId: 'u' }, ...o };
}

describe('Agent Scheduler', () => {
  const O_FLAG = process.env.ENABLE_AI_AGENT;
  const O_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_AI_AGENT = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
    mocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify([
          { title: 'Prime énergie', source: 'Gov', summary: 'MaPrimeRénov', confidence: 98 },
          { title: 'RSA jeunes', source: 'CAF', summary: 'RSA < 25', confidence: 60 },
        ]),
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25, totalTokenCount: 40 },
      },
    });
  });
  afterEach(() => {
    process.env.ENABLE_AI_AGENT = O_FLAG;
    process.env.GEMINI_API_KEY = O_KEY;
  });

  it('returns 503 when ENABLE_AI_AGENT=false', async () => {
    process.env.ENABLE_AI_AGENT = 'false';
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('rejects GET with 405', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when poleId missing', async () => {
    const res = mockRes();
    await handler(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // ── CRITICAL: No auto-validation ──────────────────
  it('sends ALL discoveries to review (no auto-validation, even confidence > 95)', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const j = res.json.mock.calls[0][0];
    expect(j.autoValidated).toBe(0);
    expect(j.pendingReview).toBe(2);
    expect(j.discovered).toBe(2);
    expect(j.submitted).toBe(2);
  });

  it('inserts ALL findings as ReviewQueueItem + AuditLog', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    // 2 ReviewQueueItem + 1 AuditLog = 3
    expect(mocks.insertFn).toHaveBeenCalledTimes(3);
    expect(mocks.insertFn).toHaveBeenNthCalledWith(1, 'ReviewQueueItem');
    expect(mocks.insertFn).toHaveBeenNthCalledWith(2, 'ReviewQueueItem');
    expect(mocks.insertFn).toHaveBeenNthCalledWith(3, 'AuditLog');
  });

  it('calls recordMetric', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(mocks.recordMetric).toHaveBeenCalledWith(expect.objectContaining({ type: 'scheduler', success: true }));
  });

  it('handles Gemini errors gracefully', async () => {
    mocks.generateContent.mockRejectedValue(new Error('Gemini is down'));
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    // Gemini failed but handler still returns 200 with 0 discoveries
    expect(res.json.mock.calls[0][0].discovered).toBe(0);
  });
});
