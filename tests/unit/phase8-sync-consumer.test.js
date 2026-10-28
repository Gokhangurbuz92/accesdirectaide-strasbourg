import { describe, it, expect, vi, beforeEach } from 'vitest';
import { consumePendingSyncRuns } from '../../api/lib/ingestion/SyncQueueConsumer.js';
import { db } from '../../src/db/index.js';
import * as SourceRegistry from '../../api/lib/ingestion/SourceRegistry.js';
import * as IngestStructures from '../../api/_handlers/cron/ingest-structures.js';

vi.mock('../../src/db/index.js', () => {
  let jobs = [];
  const whereMock = vi.fn(() => ({ 
    returning: vi.fn(() => Promise.resolve(jobs)),
    then: function(resolve) { resolve(jobs); }
  }));
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            // PKG-11 / A06 overlay (A06_SYNC_QUEUE_OVERLAY_V1.md): the consumer takes the OLDEST pending job
            orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(jobs)) })),
            limit: vi.fn(() => Promise.resolve(jobs))
          }))
        }))
      })),
      update: updateMock,
      _setMockJobs: (mockJobs) => { jobs = mockJobs; },
      _getSetMock: () => setMock
    }
  };
});

vi.mock('../../api/lib/ingestion/SourceRegistry.js', () => ({
  getSource: vi.fn()
}));

vi.mock('../../api/_handlers/cron/ingest-structures.js', () => ({
  runIngestStructures: vi.fn().mockResolvedValue({ created: 5, processed: 5, errors: [] })
}));

describe('FR-015: Background Sync Consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing if no pending jobs', async () => {
    db._setMockJobs([]);
    const res = await consumePendingSyncRuns();
    expect(res.ok).toBe(true);
    expect(res.message).toBe('No pending jobs');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('transitions PENDING -> RUNNING -> COMPLETE', async () => {
    const mockJobId = 'job-123';
    db._setMockJobs([{ id: mockJobId, status: 'PENDING', source_id: 'src-1' }]);   // A06 overlay: the real column key
    
    SourceRegistry.getSource.mockResolvedValue({ 
      id: 'src-1', 
      capabilities: ['DIRECTORY'] 
    });

    const res = await consumePendingSyncRuns();
    
    expect(res.ok).toBe(true);
    expect(res.status).toBe('COMPLETE');
    expect(db.update).toHaveBeenCalledTimes(2); // One for RUNNING, one for COMPLETE
    
    const setMock = db._getSetMock();
    const runningCall = setMock.mock.calls[0][0];
    expect(runningCall.status).toBe('RUNNING');
    expect(runningCall.started_at).toBeInstanceOf(Date);   // A06 overlay: real columns only
    expect(SourceRegistry.getSource).toHaveBeenCalledWith('src-1');

    const completeCall = setMock.mock.calls[1][0];
    expect(completeCall.status).toBe('COMPLETE');
    expect(completeCall.stats.addedItems).toBe(5);         // A06 overlay: the counts live in the stats column (there is no addedItems column)
    expect(completeCall.ended_at).toBeInstanceOf(Date);
    expect(Object.keys(completeCall).sort()).toEqual(['ended_at', 'stats', 'status']);
  });
});
