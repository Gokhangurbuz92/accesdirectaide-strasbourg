import { describe, it, expect, beforeEach } from 'vitest';
import { registerSource, getSource, updateSource, clearRegistry } from '../../api/lib/ingestion/SourceRegistry.js';

describe('SourceRegistry UPSERT Semantics', () => {
  beforeEach(async () => {
    process.env.USE_MOCKS = 'true';
    await clearRegistry();
  });

  it('preserves operational state upon re-registration', async () => {
    await registerSource({
      sourceId: 'test-source', name: 'Test', type: 'REST_API', endpoint: 'http://test', capabilities: ['REFERENCE']
    });
    
    // update operational state
    await updateSource('test-source', { failureCount: 3, lastSyncAt: new Date('2026-01-01') });
    
    // re-register
    await registerSource({
      sourceId: 'test-source', name: 'Test Updated Name', type: 'REST_API', endpoint: 'http://test', capabilities: ['REFERENCE']
    });
    
    const source = await getSource('test-source');
    expect(source.name).toBe('Test Updated Name');
    expect(source.failureCount).toBe(3);
    expect(source.lastSyncAt).not.toBeNull();
  });
  
  it('protects clearRegistry in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_CLEAR_REGISTRY = '';
    await expect(clearRegistry()).rejects.toThrow('Forbidden: Cannot clear registry in production');
    process.env.NODE_ENV = 'test';
  });
});
