import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../api/_utils/env.js', () => ({
  env: {
    kv: { url: 'https://mock-redis', token: 'mock-token' },
    runtime: { vercelEnv: 'production' }
  }
}));

vi.mock('../../api/_utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// We must mock the redis package so it throws
vi.mock('@upstash/ratelimit', () => {
  return {
    Ratelimit: vi.fn().mockImplementation(() => {
      return {
        limit: vi.fn().mockRejectedValue(new Error('Redis is down'))
      };
    })
  };
});
vi.mock('@upstash/ratelimit', async (importOriginal) => {
    return {
        Ratelimit: vi.fn().mockImplementation(() => {
            return {
                limit: vi.fn().mockRejectedValue(new Error('Redis connection failed'))
            }
        })
    };
});
// Need to handle Ratelimit.slidingWindow
vi.mock('@upstash/ratelimit', () => ({
    Ratelimit: class {
        static slidingWindow() { return {}; }
        limit() { return Promise.reject(new Error('Redis offline')); }
    }
}));

import { checkRateLimit } from '../../api/_utils/rateLimit.js';

describe('Rate Limit Degradation Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows PUBLIC_READ actions to fail-open (degrade safely) when Redis fails', async () => {
    const res = await checkRateLimit('SEARCH_AIDES', 'ip:127.0.0.1');
    expect(res.allowed).toBe(true);
  });

  it('blocks AUTH_OR_SENSITIVE_MUTATION actions (fail-closed) when Redis fails', async () => {
    const res = await checkRateLimit('LOGIN_PRO', 'ip:127.0.0.1');
    expect(res.allowed).toBe(false);
    expect(res.status).toBe(503);
    expect(res.error.code).toBe('RATE_LIMIT_ERROR');
  });

  it('blocks UNKNOWN actions (fail-closed) when Redis fails in production', async () => {
    const res = await checkRateLimit('UNKNOWN_MYSTERY_ACTION', 'ip:127.0.0.1');
    expect(res.allowed).toBe(false);
    expect(res.status).toBe(503);
    expect(res.error.code).toBe('RATE_LIMIT_ERROR');
  });
});
