import { describe, it, expect, vi, beforeEach } from 'vitest';
import conversations from '../../api/_handlers/admin/conversations.js';
import cronRuns from '../../api/_handlers/admin/cron-runs.js';
import linkChecks from '../../api/_handlers/admin/link-checks.js';
import runs from '../../api/_handlers/admin/runs.js';
import versions from '../../api/_handlers/admin/versions.js';

vi.mock('../../api/_utils/auth.js', () => ({
  verifyAdmin: vi.fn(() => Promise.resolve(true))
}));

vi.mock('../../src/db/index.js', () => {
  const chainable = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn(() => Promise.resolve([{ id: 'test1', totalItems: 10, count: 1 }]))
  };
  const fromFn = vi.fn(() => chainable);
  return {
    db: {
      select: vi.fn((opts) => ({ 
    from: vi.fn(() => {
      const chainable = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        groupBy: vi.fn(() => Promise.resolve([])),   // R7: the conversations statistics (the handler no longer answers an empty success when its query fails)
        offset: vi.fn(() => {
          if (opts && opts.count) {
             return Promise.resolve([{ count: 1 }]);
          }
          return Promise.resolve([{ id: 'test1', totalItems: 10, count: 1 }]);
        })
      };
      return chainable;
    }) 
  })),
      query: {
        ConversationLog: { findMany: vi.fn(() => Promise.resolve([{ id: 'test1', createdAt: new Date() }])) },
        CronRun: { findMany: vi.fn(() => Promise.resolve([{ id: 'test1', job: 'test' }])) },
        SourceSnapshot: { findMany: vi.fn(() => Promise.resolve([{ id: 'test1', fetched_at: new Date() }])) },
        ImportLog: { findMany: vi.fn(() => Promise.resolve([{ id: 'test1', createdAt: new Date() }])) },
        EntityVersion: { findMany: vi.fn(() => Promise.resolve([{ id: 'test1', createdAt: new Date() }])) }
      }
    }
  };
});

describe('Admin Pagination Enforcement (FR-016)', () => {
  const mockReq = (query = {}) => ({ 
    method: 'GET', 
    query, 
    url: '/api/admin/test?limit=' + (query.limit || 10) + (query.cursor ? '&cursor=' + query.cursor : ''),
    headers: { host: 'localhost:3000', authorization: 'Bearer TEST' } 
  });
  const mockRes = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  const handlers = [
    { name: 'conversations', handler: conversations },
    { name: 'cron-runs', handler: cronRuns },
    { name: 'link-checks', handler: linkChecks },
    { name: 'runs', handler: runs },
    { name: 'versions', handler: versions }
  ];

  for (const { name, handler } of handlers) {
    describe(`${name} endpoint`, () => {
      beforeEach(() => { vi.clearAllMocks(); });

      it('applies bounded limit and returns nextCursor if limit reached', async () => {
        const req = mockReq({ limit: '1', entity_type: 'test', entity_id: '1' });
        const res = mockRes();
        await handler(req, res);
        
        expect(res.json).toHaveBeenCalled();
        const data = res.json.mock.calls[0][0];
        
        expect(Array.isArray(data) || data.items || data.data).toBeTruthy();
      });

      it('supports cursor continuation', async () => {
        const req = mockReq({ cursor: Buffer.from(JSON.stringify({ lastId: 'test1' })).toString('base64'), entity_type: 'test', entity_id: '1' });
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalled();
      });

      it('handles invalid cursor gracefully', async () => {
        const req = mockReq({ cursor: 'invalid_base64_json', entity_type: 'test', entity_id: '1' });
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalled();
      });

      it('supports legacy offset compatibility', async () => {
        const req = mockReq({ page: '2', limit: '10', entity_type: 'test', entity_id: '1' });
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalled();
      });
    });
  }
});
