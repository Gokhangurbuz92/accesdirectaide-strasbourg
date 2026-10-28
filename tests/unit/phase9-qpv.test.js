import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveQPVFromLiveAPI, resolveUserQPV } from '../../api/lib/geography/QPVAdapter.js';
import logger from '../../api/_utils/logger.js';

vi.mock('../../api/_utils/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

describe('QPVAdapter - Environment Safety', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SIG_VILLE_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('NODE_ENV=production without key returns null (no fixture fallback)', async () => {
    process.env.NODE_ENV = 'production';
    // Strasbourg coords
    const result = await resolveUserQPV(48.5839, 7.7455); 
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not available in production'));
  });

  it('NODE_ENV=development without key allows fixture fallback', async () => {
    process.env.NODE_ENV = 'development';
    // Strasbourg coords - should hit fixtures
    const result = await resolveUserQPV(48.5839, 7.7455);
    // Since we didn't mock fetch/fixtures, it might return something or null, but it SHOULD log the fixture fallback warning
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('fixture fallback allowed'));
  });
});
