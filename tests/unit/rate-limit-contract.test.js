import { describe, it, expect } from 'vitest';

/**
 * Rate limiting contract tests.
 */
describe('Rate limiting', () => {
  it('rate limit utility exists', async () => {
    const mod = await import('../../api/_utils/rateLimit.js');
    expect(mod).toBeDefined();
  });

  it('exports checkRateLimit', async () => {
    const mod = await import('../../api/_utils/rateLimit.js');
    expect(typeof mod.checkRateLimit).toBe('function');
  });

  it('exports getClientIp', async () => {
    const mod = await import('../../api/_utils/rateLimit.js');
    expect(typeof mod.getClientIp).toBe('function');
  });

  it('exports getRateLimitStatus', async () => {
    const mod = await import('../../api/_utils/rateLimit.js');
    expect(typeof mod.getRateLimitStatus).toBe('function');
  });
});
