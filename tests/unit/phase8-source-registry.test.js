import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerSource,
  getSource,
  listSources,
  updateSource,
  disableSource,
  recordSyncResult,
  getActiveConnectors,
  clearRegistry
} from '../../api/lib/ingestion/SourceRegistry.js';

describe('SourceRegistry', () => {
  const origUseMocks = process.env.USE_MOCKS;

  beforeEach(async () => {
    process.env.USE_MOCKS = 'true';
    await clearRegistry();
  });

  afterEach(() => {
    if (origUseMocks !== undefined) {
      process.env.USE_MOCKS = origUseMocks;
    } else {
      delete process.env.USE_MOCKS;
    }
  });

  it('registers a source with valid data', async () => {
    const source = await registerSource({ sourceId: 'src1', name: 'Source 1', type: 'REST' });
    expect(source.sourceId).toBe('src1');
    expect(source.status).toBe('ACTIVE');
  });

  it('rejects invalid source data', async () => {
    await expect(registerSource({ type: 'REST' })).rejects.toThrow();
  });

  it('gets registered source', async () => {
    await registerSource({ sourceId: 'src2', name: 'Source 2', type: 'REST' });
    const source = await getSource('src2');
    expect(source).not.toBeNull();
    expect(source.name).toBe('Source 2');
  });

  it('returns null for missing source', async () => {
    expect(await getSource('missing')).toBeNull();
  });

  it('lists sources with filters', async () => {
    await registerSource({ sourceId: 's1', name: 'S1', type: 'API', capabilities: ['A'] });
    await registerSource({ sourceId: 's2', name: 'S2', type: 'API', capabilities: ['B'] });
    await disableSource('s2', 'test');
    const active = await listSources({ status: 'ACTIVE' });
    expect(active.length).toBe(1);
    expect(active[0].sourceId).toBe('s1');
  });

  it('updates a source', async () => {
    await registerSource({ sourceId: 's3', name: 'S3', type: 'API' });
    await updateSource('s3', { name: 'S3 Updated' });
    expect((await getSource('s3')).name).toBe('S3 Updated');
  });

  it('disables a source', async () => {
    await registerSource({ sourceId: 's4', name: 'S4', type: 'API' });
    await disableSource('s4', 'Reason');
    const s = await getSource('s4');
    expect(s.status).toBe('DISABLED');
    expect(s.disableReason).toBe('Reason');
  });

  it('recordSyncResult resets failure count on success', async () => {
    await registerSource({ sourceId: 's5', name: 'S5', type: 'API' });
    await updateSource('s5', { failureCount: 5 });
    await recordSyncResult('s5', true);
    expect((await getSource('s5')).failureCount).toBe(0);
  });

  it('recordSyncResult auto-disables after 10 failures', async () => {
    await registerSource({ sourceId: 's6', name: 'S6', type: 'API' });
    for(let i = 0; i < 10; i++) await recordSyncResult('s6', false);
    expect((await getSource('s6')).status).toBe('DISABLED');
    expect((await getSource('s6')).failureCount).toBe(10);
  });

  it('getActiveConnectors returns only active sources', async () => {
    await registerSource({ sourceId: 's7', name: 'S7', type: 'API' });
    await registerSource({ sourceId: 's8', name: 'S8', type: 'API' });
    await disableSource('s8', 'test');
    const active = await getActiveConnectors();
    expect(active.length).toBe(1);
    expect(active[0].sourceId).toBe('s7');
  });
});
