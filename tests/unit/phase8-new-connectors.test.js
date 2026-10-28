import { describe, it, expect } from 'vitest';
import FranceServicesConnector from '../../api/lib/ingestion/FranceServicesConnector.js';
import LegifranceConnector from '../../api/lib/ingestion/LegifranceConnector.js';
import DataGouvConnector from '../../api/lib/ingestion/DataGouvConnector.js';
import CafOpenDataConnector from '../../api/lib/ingestion/CafOpenDataConnector.js';
import FranceTravailConnector from '../../api/lib/ingestion/FranceTravailConnector.js';

describe('Phase 8 New Connectors', () => {
  describe('FranceServicesConnector', () => {
    it('implements full ConnectorContract lifecycle', async () => {
      const connector = new FranceServicesConnector();
      const discover = await connector.discover();
      expect(discover).toBeDefined();

      const fetchResult = await connector.fetch();
      expect(fetchResult.items).toBeDefined();
      expect(fetchResult.items.length).toBe(0);

      const validateResult = await connector.validate([]);
      expect(validateResult.valid).toBeDefined();

      const normalizeResult = await connector.normalize([]);
      expect(normalizeResult).toBeDefined();
    });

    it('has correct capabilities (DIRECTORY, LOCAL_SERVICE)', async () => {
      const connector = new FranceServicesConnector();
      expect(connector.metadata.capabilities).toContain('DIRECTORY');
      expect(connector.metadata.capabilities).toContain('LOCAL_SERVICE');
    });

    it('has correct producer (ANCT)', async () => {
      const connector = new FranceServicesConnector();
      expect(connector.producerAuthority).toBe('ANCT');
    });
  });

  describe('LegifranceConnector', () => {
    it('has accessStatus EXTERNAL_ACTION_REQUIRED', async () => {
      const connector = new LegifranceConnector();
      expect(connector.accessStatus).toBe('EXTERNAL_ACTION_REQUIRED');
    });

    it('has correct capabilities (LEGAL, REGULATORY)', async () => {
      const connector = new LegifranceConnector();
      expect(connector.metadata.capabilities).toContain('LEGAL');
      expect(connector.metadata.capabilities).toContain('REGULATORY');
    });
  });

  describe('DataGouvConnector', () => {
    it('preserves producer authority (not data.gouv.fr itself)', async () => {
      const connector = new DataGouvConnector();
      const discover = await connector.discover();
      expect(discover.note).toContain('Authority belongs to the underlying producer.');
    });

    it('has capabilities OPEN_DATA_CATALOG, REFERENCE', async () => {
      const connector = new DataGouvConnector();
      expect(connector.metadata.capabilities).toContain('OPEN_DATA_CATALOG');
      expect(connector.metadata.capabilities).toContain('REFERENCE');
    });
  });

  describe('CafOpenDataConnector', () => {
    it('has STATISTICAL capability, NOT LOCAL_SERVICE', async () => {
      const connector = new CafOpenDataConnector();
      expect(connector.metadata.capabilities).toContain('STATISTICAL');
      expect(connector.metadata.capabilities).not.toContain('LOCAL_SERVICE');
    });

    it('discover note mentions does NOT provide individual eligibility', async () => {
      const connector = new CafOpenDataConnector();
      const discover = await connector.discover();
      expect(discover.note).toContain('does NOT provide individual eligibility');
    });
  });

  describe('FranceTravailConnector', () => {
    it('has accessStatus EXTERNAL_ACTION_REQUIRED', async () => {
      const connector = new FranceTravailConnector();
      expect(connector.accessStatus).toBe('EXTERNAL_ACTION_REQUIRED');
    });
  });

  describe('All connectors', () => {
    it('handle empty fetch safely', async () => {
      const connectors = [
        new FranceServicesConnector(),
        new LegifranceConnector(),
        new DataGouvConnector(),
        new CafOpenDataConnector(),
        new FranceTravailConnector()
      ];

      for (const connector of connectors) {
        const fetchResult = await connector.fetch();
        expect(fetchResult.items).toEqual([]);
        expect(fetchResult.fetchedAt).toBeInstanceOf(Date);
        expect(fetchResult.syncRunId).toBeDefined();
      }
    });
  });
});
