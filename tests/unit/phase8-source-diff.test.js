import { describe, it, expect } from 'vitest';
import {
  computeContentHash,
  computeDiff,
  batchComputeDiff,
  classifyChange,
  shouldInvalidateEmbedding
} from '../../api/lib/services/source-diff.js';

describe('source-diff', () => {
  it('computeContentHash is deterministic', () => {
    expect(computeContentHash('test')).toBe(computeContentHash('test'));
    expect(computeContentHash('test')).not.toBe(computeContentHash('test2'));
  });

  it('computeDiff: NEW when no existing hash', () => {
    expect(computeDiff('source', '1', 'hash1', null)).toBe('NEW');
    expect(computeDiff('source', '1', 'hash1', undefined)).toBe('NEW');
  });

  it('computeDiff: UNCHANGED when hashes match', () => {
    expect(computeDiff('source', '1', 'hash1', 'hash1')).toBe('UNCHANGED');
  });

  it('computeDiff: UPDATED when hashes differ', () => {
    expect(computeDiff('source', '1', 'hash1', 'hash2')).toBe('UPDATED');
  });

  it('batchComputeDiff: correct tagging of array', () => {
    const items = [
      { entityType: 's', entityId: '1', newHash: 'h1', existingHash: null },
      { entityType: 's', entityId: '2', newHash: 'h2', existingHash: 'h2' },
      { entityType: 's', entityId: '3', newHash: 'h3', existingHash: 'h4' }
    ];
    const res = batchComputeDiff(items);
    expect(res[0]._diffState).toBe('NEW');
    expect(res[1]._diffState).toBe('UNCHANGED');
    expect(res[2]._diffState).toBe('UPDATED');
  });

  it('classifyChange: METADATA_ONLY_CHANGED', () => {
    expect(classifyChange('raw', 'raw', 'norm', 'norm')).toBe('METADATA_ONLY_CHANGED');
  });

  it('classifyChange: RAW_CONTENT_CHANGED', () => {
    expect(classifyChange('raw1', 'raw2', 'norm', 'norm')).toBe('RAW_CONTENT_CHANGED');
  });

  it('classifyChange: NORMALIZED_FACT_CHANGED', () => {
    expect(classifyChange('raw1', 'raw2', 'norm1', 'norm2')).toBe('NORMALIZED_FACT_CHANGED');
  });

  it('shouldInvalidateEmbedding', () => {
    expect(shouldInvalidateEmbedding('NORMALIZED_FACT_CHANGED')).toBe(true);
    expect(shouldInvalidateEmbedding('RAW_CONTENT_CHANGED')).toBe(false);
    expect(shouldInvalidateEmbedding('METADATA_ONLY_CHANGED')).toBe(false);
  });
});
