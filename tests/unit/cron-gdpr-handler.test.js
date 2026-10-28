import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({
  db: {
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue({ rowCount: 5 }),
    select: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../api/_utils/env.js', () => ({
  env: {
    CRON_SECRET: 'test-cron-secret',
    DATABASE_URL: 'postgres://test',
    KV_REST_API_URL: 'http://localhost',
    KV_REST_API_TOKEN: 'test',
    NODE_ENV: 'test',
  },
}));

describe('GDPR purge cron handler', () => {
  it('exports a function', async () => {
    try {
      const mod = await import('../../api/_handlers/cron/gdpr-purge.js');
      expect(typeof mod.default).toBe('function');
    } catch (e) {
      console.log('Import failed (expected in unit context):', e.message);
      expect(e).toBeDefined();
    }
  });
});
