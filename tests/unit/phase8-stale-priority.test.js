import { describe, it, expect } from 'vitest';
import {
  getStaleSourcesFirst,
  shouldPrioritizeRefresh,
  createBoundedRetry
} from '../../api/lib/services/freshness.js';

describe('stale-priority', () => {
  const mockNow = new Date('2026-09-02T12:00:00Z');
  
  it('getStaleSourcesFirst: STALE sources come before FRESH', () => {
    const freshSource = { id: 'fresh', lastVerified: '2026-09-01T12:00:00Z' }; // 1 day ago
    const staleSource = { id: 'stale', lastVerified: '2025-01-01T12:00:00Z' }; // very old
    
    const sorted = getStaleSourcesFirst([freshSource, staleSource], { now: mockNow });
    expect(sorted[0].id).toBe('stale');
    expect(sorted[1].id).toBe('fresh');
  });

  it('shouldPrioritizeRefresh: true for STALE, false for FRESH', () => {
    const freshSource = { id: 'fresh', lastVerified: '2026-09-01T12:00:00Z' };
    const staleSource = { id: 'stale', lastVerified: '2025-01-01T12:00:00Z' };
    
    expect(shouldPrioritizeRefresh(freshSource, { now: mockNow })).toBe(false);
    expect(shouldPrioritizeRefresh(staleSource, { now: mockNow })).toBe(true);
  });

  it('createBoundedRetry: respects maxRetries', () => {
    const retry = createBoundedRetry(2, 100);
    expect(retry.attempt).toBe(0);
    expect(retry.shouldRetry()).toBe(true);
    expect(retry.attempt).toBe(1);
    expect(retry.shouldRetry()).toBe(true);
    expect(retry.attempt).toBe(2);
    expect(retry.shouldRetry()).toBe(false); // Max reached
    expect(retry.attempt).toBe(2);
  });

  it('createBoundedRetry: delay increases exponentially', () => {
    const retry = createBoundedRetry(3, 100);
    retry.shouldRetry();
    const delay1 = retry.getDelay();
    expect(delay1).toBeGreaterThanOrEqual(100);
    expect(delay1).toBeLessThan(300);
    
    retry.shouldRetry();
    const delay2 = retry.getDelay();
    expect(delay2).toBeGreaterThanOrEqual(200); // 100 * 2^1
    expect(delay2).toBeLessThan(400);
  });
});
