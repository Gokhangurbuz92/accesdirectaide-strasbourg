import { describe, it, expect } from 'vitest';
import {
  SyncCompletionState,
  createSyncRun,
  completeSyncRun,
  executeWithTransactionSafety,
  isEmptyResponseSafe,
  preserveLastKnownGood
} from '../../api/lib/ingestion/sync-safety.js';

describe('Sync Safety', () => {
  it('creates valid sync run', () => {
    const run = createSyncRun('src1');
    expect(run.id).toBeDefined();
    expect(run.sourceId).toBe('src1');
    expect(run.state).toBeNull();
    expect(run.startedAt).toBeInstanceOf(Date);
  });

  it('completes sync run', () => {
    const run = createSyncRun('src1');
    const completed = completeSyncRun(run, SyncCompletionState.COMPLETE, { fetched: 10 });
    expect(completed.state).toBe(SyncCompletionState.COMPLETE);
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(completed.stats.fetched).toBe(10);
  });

  it('blocks empty response deletion', () => {
    const result = isEmptyResponseSafe([], 5);
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('EMPTY_RESPONSE_WITH_EXISTING_DATA');
  });

  it('allows empty response if no existing data', () => {
    const result = isEmptyResponseSafe([], 0);
    expect(result.safe).toBe(true);
  });

  it('preserves last known good state', () => {
    const preserved = preserveLastKnownGood('ent1', 2);
    expect(preserved.entityId).toBe('ent1');
    expect(preserved.preservedVersion).toBe(2);
    expect(preserved.flaggedForReview).toBe(true);
  });

  it('executes transaction safely (success)', async () => {
    const operation = async () => 'done';
    const result = await executeWithTransactionSafety('run1', operation);
    expect(result.success).toBe(true);
    expect(result.result).toBe('done');
  });

  it('executes transaction safely (failure)', async () => {
    const operation = async () => { throw new Error('fail'); };
    const result = await executeWithTransactionSafety('run1', operation);
    expect(result.success).toBe(false);
    expect(result.rollbackPerformed).toBe(true);
    expect(result.error).toBe('fail');
  });
  
  it('has valid enum values', () => {
    expect(SyncCompletionState.COMPLETE).toBe('COMPLETE');
    expect(SyncCompletionState.PARTIAL).toBe('PARTIAL');
    expect(SyncCompletionState.FAILED).toBe('FAILED');
  });
});
