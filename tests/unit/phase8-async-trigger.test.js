import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../../api/_handlers/admin/source-trigger.js';
import { db } from '../../src/db/index.js';
import * as SourceRegistry from '../../api/lib/ingestion/SourceRegistry.js';

vi.mock('../../api/_utils/auth.js', () => ({
  requireAdminAuth: (h) => h
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue({})
    }))
  }
}));

vi.mock('../../api/lib/ingestion/SourceRegistry.js', () => ({
  getSource: vi.fn()
}));

describe('FR-015: Async Source Trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid source with 404', async () => {
    SourceRegistry.getSource.mockResolvedValue(null);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    
    await handler({ method: 'POST', query: { id: 'invalid' } }, res);
    
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('persists a real pending job and returns 202', async () => {
    SourceRegistry.getSource.mockResolvedValue({ id: 'valid-source' });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    
    await handler({ method: 'POST', query: { id: 'valid-source' } }, res);
    
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Sync job persisted and pending background execution',
      syncRunId: expect.any(String),
      status: 'PENDING'
    }));
  });
});
