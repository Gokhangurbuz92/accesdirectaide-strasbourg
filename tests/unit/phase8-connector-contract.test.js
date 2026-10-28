import { describe, it, expect, vi } from 'vitest';
import { ConnectorContract, ConnectorMetadataSchema, SyncRunState } from '../../api/lib/ingestion/ConnectorContract.js';

describe('ConnectorContract', () => {
  describe('ConnectorMetadataSchema', () => {
    it('validates a correct metadata object', () => {
      const valid = {
        sourceId: 'test-source',
        name: 'Test Source',
        version: '1.0.0',
        entityType: 'Aide',
        capabilities: ['LEGAL', 'BENEFIT_RULE']
      };
      
      const result = ConnectorMetadataSchema.safeParse(valid);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(valid);
    });

    it('rejects invalid metadata', () => {
      const invalid = {
        sourceId: '', // min length 1
        name: 'Test',
        entityType: 'InvalidType',
        capabilities: [] // min length 1
      };
      
      const result = ConnectorMetadataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('Constructor', () => {
    it('initializes with valid metadata', () => {
      const metadata = {
        sourceId: 'test-source',
        name: 'Test Source',
        entityType: 'Aide',
        capabilities: ['LEGAL']
      };
      
      const connector = new ConnectorContract(metadata);
      expect(connector.metadata.sourceId).toBe('test-source');
      expect(connector.metadata.version).toBe('1.0.0'); // default
    });

    it('throws on invalid metadata', () => {
      expect(() => new ConnectorContract({ name: 'Test' })).toThrow();
    });
  });

  describe('Lifecycle methods default implementation', () => {
    const connector = new ConnectorContract({
      sourceId: 'test', name: 'test', entityType: 'Aide', capabilities: ['LEGAL']
    });

    it('throws not implemented for discover', async () => {
      await expect(connector.discover()).rejects.toThrow('ConnectorContract.discover() not implemented');
    });

    it('throws not implemented for fetch', async () => {
      await expect(connector.fetch()).rejects.toThrow('ConnectorContract.fetch() not implemented');
    });

    it('throws not implemented for validate', async () => {
      await expect(connector.validate([])).rejects.toThrow('ConnectorContract.validate() not implemented');
    });

    it('throws not implemented for normalize', async () => {
      await expect(connector.normalize([])).rejects.toThrow('ConnectorContract.normalize() not implemented');
    });

    it('throws not implemented for diff', async () => {
      await expect(connector.diff([])).rejects.toThrow('ConnectorContract.diff() not implemented');
    });

    it('throws not implemented for persist', async () => {
      await expect(connector.persist([], '123')).rejects.toThrow('ConnectorContract.persist() not implemented');
    });

    it('throws not implemented for verify', async () => {
      await expect(connector.verify([])).rejects.toThrow('ConnectorContract.verify() not implemented');
    });

    it('throws not implemented for report', async () => {
      await expect(connector.report('123', SyncRunState.COMPLETE, {})).rejects.toThrow('ConnectorContract.report() not implemented');
    });
  });

  describe('execute()', () => {
    class MockConnector extends ConnectorContract {
      constructor(metadata) {
        super(metadata);
        this.emptyResponse = false;
        this.shouldThrow = false;
        this.reportSpy = vi.fn();
      }

      async discover() { return {}; }
      
      async fetch() {
        if (this.shouldThrow) throw new Error('Fetch failed');
        if (this.emptyResponse) return { items: [], fetchedAt: new Date(), syncRunId: 'abc' };
        return { items: [1, 2], fetchedAt: new Date(), syncRunId: 'abc' };
      }

      async validate(rawItems) {
        return {
          valid: rawItems,
          rejected: [],
          errors: []
        };
      }

      async normalize(validItems) {
        return validItems.map(item => ({ id: item, data: 'norm' }));
      }

      async diff(normalizedItems) {
        return normalizedItems.map((item, idx) => ({
          ...item,
          _diffState: idx === 0 ? 'NEW' : 'UNCHANGED'
        }));
      }

      async persist(diffedItems, syncRunId) {
        return diffedItems;
      }

      async verify(persistedItems) {
        return { verified: persistedItems.length, failed: 0 };
      }

      async report(syncRunId, state, stats) {
        this.reportSpy(syncRunId, state, stats);
      }
    }

    const metadata = { sourceId: 'mock', name: 'Mock', entityType: 'Aide', capabilities: ['LEGAL'] };

    it('handles empty response safely', async () => {
      const connector = new MockConnector(metadata);
      connector.emptyResponse = true;

      const result = await connector.execute();

      expect(result.state).toBe(SyncRunState.PARTIAL);
      expect(result.stats.fetched).toBe(0);
      expect(result.stats.errors).toContain('Empty response from source — preserving last-known-good');
      expect(connector.reportSpy).toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      const connector = new MockConnector(metadata);
      connector.shouldThrow = true;

      const result = await connector.execute();

      expect(result.state).toBe(SyncRunState.FAILED);
      expect(result.stats.errors).toContain('Fetch failed');
      expect(connector.reportSpy).toHaveBeenCalled();
    });

    it('computes correct stats for a successful run', async () => {
      const connector = new MockConnector(metadata);
      const result = await connector.execute();

      expect(result.state).toBe(SyncRunState.COMPLETE);
      expect(result.stats.fetched).toBe(2);
      expect(result.stats.validated).toBe(2);
      expect(result.stats.rejected).toBe(0);
      expect(result.stats.created).toBe(1);
      expect(result.stats.unchanged).toBe(1);
      expect(result.stats.updated).toBe(0);
      expect(connector.reportSpy).toHaveBeenCalled();
    });
  });

  describe('SyncRunState Enum', () => {
    it('has correct values', () => {
      expect(SyncRunState.COMPLETE).toBe('COMPLETE');
      expect(SyncRunState.PARTIAL).toBe('PARTIAL');
      expect(SyncRunState.FAILED).toBe('FAILED');
    });
  });
});
