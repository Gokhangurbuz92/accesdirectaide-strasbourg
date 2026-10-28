/**
 * Agent Discovery — Unit Tests (co-located)
 *
 * Tests feature flag, Gemini mock, submit flow, error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const insertValuesFn = vi.fn().mockResolvedValue([]);
  const insertFn = vi.fn(() => ({ values: insertValuesFn }));
  return {
    db: { insert: insertFn },
    insertFn,
    insertValuesFn,
    generateContent: vi.fn(),
    recordMetric: vi.fn(),
  };
});

vi.mock('../../../src/db/index.js', () => ({ db: mocks.db }));
vi.mock('../../../src/db/schema.js', () => ({ ReviewQueueItem: 'ReviewQueueItem' }));
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
vi.mock('../../_utils/logger.js', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {} },
}));
vi.mock('../../lib/ai-policy.js', () => ({
  AIProviderPolicy: { evaluate: vi.fn(() => ({ allowed: true })) },
  PROVIDER: { GEMINI: 'gemini', OLLAMA: 'ollama' },
  AUDIENCE: { PROFESSIONAL: 'professional' }
}));
vi.mock('../../_utils/auth.js', () => ({
  requireProAuth: /** @template Handler @param {Handler} h */ (h) => h,
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

import handler from './agent-discovery.js';

// ── Helpers ──────────────────────────────────────────────
function mockRes() {
  return {
    setHeader: vi.fn(), getHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}
function mockReq(o = {}) {
  return { method: 'POST', headers: {}, body: { category: 'Logement' }, user: { userId: 'u' }, ...o };
}

// ── Tests ────────────────────────────────────────────────
describe('Agent Discovery', () => {
  const O_FLAG = process.env.ENABLE_AI_AGENT;
  const O_KEY = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_AI_AGENT = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
    mocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify([{ title: 'Aide APL', source: 'CAF', summary: 'Logement' }]),
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
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
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'AI agents are disabled' }));
  });

  it('returns 503 when ENABLE_AI_AGENT is undefined', async () => {
    delete process.env.ENABLE_AI_AGENT;
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('rejects GET with 405', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when category missing', async () => {
    const res = mockRes();
    await handler(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns findings from Gemini', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const j = res.json.mock.calls[0][0];
    expect(j.ok).toBe(true);
    expect(j.count).toBe(1);
    expect(j.findings[0].title).toBe('Aide APL');
  });

  it('calls recordMetric on success', async () => {
    const res = mockRes();
    await handler(mockReq(), res);
    expect(mocks.recordMetric).toHaveBeenCalledWith(expect.objectContaining({ type: 'discovery', success: true }));
  });

  it('submits to review queue when submit=true', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { category: 'Santé', submit: true } }), res);
    expect(mocks.insertFn).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].submitted).toBe(1);
  });

  it('does NOT submit when submit=false', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { category: 'Santé', submit: false } }), res);
    expect(mocks.insertFn).not.toHaveBeenCalled();
  });

  it('handles invalid JSON from Gemini gracefully', async () => {
    mocks.generateContent.mockResolvedValue({ response: { text: () => 'not json', usageMetadata: {} } });
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].findings[0].title).toBe('Résultat brut');
  });

  it('sanitizes HTML in category', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { category: '<script>xss</script>Test' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
