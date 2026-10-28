import { describe, it, expect } from 'vitest';
import {
  SourceRegistryEntry,
  SourceDiff,
  ConflictRecord,
  FreshnessPolicy,
  SourceType,
  SourceStatus,
  SourceCapability,
  DiffState,
  ChangeClassification,
  ConflictResolutionStatus,
  FreshnessAction
} from '../../src/db/schema';

describe('Phase 8 Schema Definitions', () => {
  it('should export all required enums with correct values', () => {
    expect(SourceType).toBeDefined();
    expect(SourceType.enumValues).toEqual(['REST_API', 'GRAPHQL', 'HTML_SCRAPER', 'RSS_ATOM', 'CSV', 'XML', 'JSON_FILE', 'CURATED']);

    expect(SourceStatus).toBeDefined();
    expect(SourceStatus.enumValues).toEqual(['ACTIVE', 'DISABLED', 'PAUSED', 'ERROR']);

    expect(SourceCapability).toBeDefined();
    expect(SourceCapability.enumValues).toEqual(['LEGAL', 'REGULATORY', 'BENEFIT_RULE', 'BENEFIT_PARAMETER', 'PROCEDURAL', 'DIRECTORY', 'STATISTICAL', 'REFERENCE', 'OPEN_DATA_CATALOG', 'LOCAL_SERVICE']);

    expect(DiffState).toBeDefined();
    expect(DiffState.enumValues).toEqual(['NEW', 'UPDATED', 'UNCHANGED', 'REMOVED', 'CONFLICTING']);

    expect(ChangeClassification).toBeDefined();
    expect(ChangeClassification.enumValues).toEqual(['RAW_CONTENT_CHANGED', 'NORMALIZED_FACT_CHANGED', 'METADATA_ONLY_CHANGED']);

    expect(ConflictResolutionStatus).toBeDefined();
    expect(ConflictResolutionStatus.enumValues).toEqual(['PENDING', 'RESOLVED', 'IGNORED']);

    expect(FreshnessAction).toBeDefined();
    expect(FreshnessAction.enumValues).toEqual(['FLAG_STALE', 'AUTO_REFRESH', 'DISABLE']);
  });

  it('should export SourceRegistryEntry with expected columns', () => {
    expect(SourceRegistryEntry).toBeDefined();
    
    // Check columns
    const columns = Object.keys(SourceRegistryEntry);
    expect(columns).toContain('id');
    expect(columns).toContain('sourceId');
    expect(columns).toContain('name');
    expect(columns).toContain('type');
    expect(columns).toContain('endpoint');
    expect(columns).toContain('status');
  });

  it('should export SourceDiff with expected columns', () => {
    expect(SourceDiff).toBeDefined();
    
    // Check columns
    const columns = Object.keys(SourceDiff);
    expect(columns).toContain('id');
    expect(columns).toContain('sourceId');
    expect(columns).toContain('entityType');
    expect(columns).toContain('diffState');
  });

  it('should export ConflictRecord with expected columns', () => {
    expect(ConflictRecord).toBeDefined();
    
    // Check columns
    const columns = Object.keys(ConflictRecord);
    expect(columns).toContain('id');
    expect(columns).toContain('entityType');
    expect(columns).toContain('sourceAId');
    expect(columns).toContain('resolutionStatus');
  });

  it('should export FreshnessPolicy with expected columns', () => {
    expect(FreshnessPolicy).toBeDefined();
    
    // Check columns
    const columns = Object.keys(FreshnessPolicy);
    expect(columns).toContain('id');
    expect(columns).toContain('sourceId');
    expect(columns).toContain('ttlDays');
    expect(columns).toContain('actionOnExpire');
  });
});
