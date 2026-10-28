import { describe, it, expect, vi, beforeEach } from 'vitest';
import markFreshHandler from '../../api/_handlers/admin/mark-fresh.js';
import overrideReputationHandler from '../../api/_handlers/admin/override-reputation.js';
import { mergeStructuresBySiret } from '../../api/lib/services/siret-merger.js';
import { db } from '../../src/db/index.js';

vi.mock('../../api/_utils/auth.js', () => ({
  requireAdminAuth: (handler) => async (req, res) => {
    req.user = { id: 'admin123', role: 'admin' };
    return handler(req, res);
  }
}));

vi.mock('../../src/db/index.js', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(true)
      }))
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([
            { id: 'struct-1', siret: '12345678901234', createdAt: '2023-01-01' },
            { id: 'struct-2', siret: '12345678901234', createdAt: '2023-02-01' }
          ])
        }))
      }))
    })),
    transaction: vi.fn(async (cb) => {
      const tx = {
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(true) })) })),
        delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(true) }))
      };
      await cb(tx);
    })
  }
}));

describe('Phase 11 Remediations', () => {
  let req, res;
  
  beforeEach(() => {
    req = { method: 'POST', body: {}, user: { id: 'admin-1' } };
    res = { 
      status: vi.fn().mockReturnThis(), 
      json: vi.fn() 
    };
    vi.clearAllMocks();
  });

  it('mark-fresh validates payload and updates timestamp', async () => {
    req.body = { entityId: 'e499d345-42df-4db2-94b6-a536f947e4eb', entityType: 'AIDE' };
    await markFreshHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(db.update).toHaveBeenCalled();
  });

  it('override-reputation validates payload and updates trustLevel', async () => {
    req.body = { sourceId: 'e499d345-42df-4db2-94b6-a536f947e4eb', trustLevel: 'HIGH' };
    await overrideReputationHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(db.update).toHaveBeenCalled();
  });

  it('siret-merger correctly calls transaction to merge duplicates', async () => {
    const result = await mergeStructuresBySiret('12345678901234');
    expect(result.success).toBe(true);
    expect(result.primaryId).toBe('struct-1');
    expect(result.mergedCount).toBe(1);
    expect(db.transaction).toHaveBeenCalled();
  });
});
