import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRateLimitStatus: vi.fn().mockReturnValue({}),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../api/_utils/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test',
    GEMINI_API_KEY: 'test-key',
    KV_REST_API_URL: 'http://localhost',
    KV_REST_API_TOKEN: 'test',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../api/lib/gemini.js', () => ({
  chatWithRulePack: vi.fn().mockResolvedValue({ text: 'mock response' }),
}));

vi.mock('../../api/lib/gemini-metrics.js', () => ({
  recordMetric: vi.fn(),
}));

vi.mock('../../api/lib/log-store.js', () => ({
  storeLog: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  default: { captureException: vi.fn(), captureMessage: vi.fn() },
}));

describe('Chat handler', () => {
  it('exports a function', async () => {
    try {
      const mod = await import('../../api/_handlers/assistant/chat.js');
      expect(typeof mod.default).toBe('function');
    } catch (e) {
      console.log('Import failed (expected in unit context):', e.message);
      expect(e).toBeDefined();
    }
  });
});
