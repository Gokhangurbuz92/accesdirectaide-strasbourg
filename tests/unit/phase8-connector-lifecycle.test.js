import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorContract, SyncRunState } from '../../api/lib/ingestion/ConnectorContract.js';

class MockConnector extends ConnectorContract {
  constructor(config = {}) {
    super({
      sourceId: 'mock_source',
      name: 'Mock Connector',
      version: '1.0.0',
      entityType: 'Aide',
      capabilities: ['BENEFIT_RULE']
    });
    this.mockData = config.mockData || [];
    this.failFetch = config.failFetch || false;
    this.emptyResponse = config.emptyResponse || false;
  }

  async discover() {
    return { available: true };
  }

  async fetch() {
    if (this.failFetch) throw new Error('Fetch failed');
    if (this.emptyResponse) return { items: [], fetchedAt: new Date(), syncRunId: 'test-sync' };
    return { items: this.mockData, fetchedAt: new Date(), syncRunId: 'test-sync' };
  }

  async validate(rawItems) {
    if (!Array.isArray(rawItems)) throw new Error('Invalid format');
    return { valid: rawItems, rejected: [], errors: [] };
  }

  async normalize(validItems) {
    return validItems.map(item => ({
      id: item.id,
      title: item.title,
      type: 'mock',
      language: 'fr'
    }));
  }

  async diff(normalizedItems) {
    return normalizedItems.map(i => ({ ...i, _diffState: 'NEW' }));
  }

  async persist(diffedItems, syncRunId) {
    // mock persist
  }

  async verify(persistedItems) {
    return { verified: persistedItems.length, failed: 0 };
  }

  async report(syncRunId, state, stats) {
    // mock report
  }
}

describe('Connector Lifecycle Integration', () => {
  let connector;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes a successful lifecycle', async () => {
    connector = new MockConnector({
      mockData: [{ id: '1', title: 'Test Item' }]
    });

    const report = await connector.execute();
    
    expect(report).toBeDefined();
    expect(report.state).toBe(SyncRunState.COMPLETE);
    expect(report.stats).toBeDefined();
    expect(report.stats.fetched).toBe(1);
    expect(report.stats.validated).toBe(1);
    expect(report.stats.created).toBe(1);
  });

  it('handles fetch errors and preserves state', async () => {
    connector = new MockConnector({
      failFetch: true
    });

    const report = await connector.execute();
    
    expect(report.state).toBe(SyncRunState.FAILED);
    expect(report.stats.errors[0]).toBe('Fetch failed');
  });

  it('handles empty response safely', async () => {
    connector = new MockConnector({
      emptyResponse: true
    });

    const report = await connector.execute();
    
    expect(report.state).toBe(SyncRunState.PARTIAL);
    expect(report.stats.errors[0]).toContain('Empty response');
  });
});

