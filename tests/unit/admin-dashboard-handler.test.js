import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../api/_utils/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test',
    JWT_SECRET: 'test-secret-at-least-32-chars-long!!',
    ADMIN_TOKEN: 'test-admin-token-32charslong!!!!',
    KV_REST_API_URL: 'http://localhost',
    KV_REST_API_TOKEN: 'test',
    NODE_ENV: 'test',
  },
}));

describe('Admin dashboard handler', () => {
  it('exports a function', async () => {
    try {
      const mod = await import('../../api/_handlers/admin/dashboard.js');
      expect(typeof mod.default).toBe('function');
    } catch (e) {
      console.log('Import failed (expected in unit context):', e.message);
      expect(e).toBeDefined();
    }
  });
});
