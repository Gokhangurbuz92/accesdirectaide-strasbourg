import { describe, it, expect, vi } from 'vitest';
import { ConnectorContractAdapter } from '../../api/lib/ingestion/ConnectorContractAdapter.js';
import { createGrandEstContractConnector } from '../../api/lib/ingestion/GrandEstConnector.js';
import { createAgefiphContractConnector } from '../../api/lib/ingestion/AgefiphConnector.js';
import { createAidesTerritoiresContractConnector } from '../../api/lib/ingestion/AidesTerritoiresConnector.js';
import { createDreesContractConnector } from '../../api/lib/ingestion/DreesConnector.js';
import { createServicePublicDemarchesContractConnector } from '../../api/lib/ingestion/ServicePublicDemarchesConnector.js';
import { createFinessContractConnector } from '../../api/lib/ingestion/FinessConnector.js';
import { createRnaContractConnector } from '../../api/lib/ingestion/RnaConnector.js';
import { createDemarchesSimplifieesContractConnector } from '../../api/lib/ingestion/DemarchesSimplifieesConnector.js';
import { createMesAidesRenoContractConnector } from '../../api/lib/ingestion/MesAidesRenoConnector.js';
import { ActualitesRssContractAdapter } from '../../api/lib/ingestion/ActualitesRssAdapter.js';
import { StrasbourgStructuresContractAdapter } from '../../api/lib/ingestion/StrasbourgStructuresAdapter.js';

describe('ConnectorContractAdapter', () => {
  it('wraps a mock legacy connector', async () => {
    const mockLegacy = {
      baseUrl: 'http://test.com',
      fetchAll: vi.fn().mockResolvedValue([{ id: 1, title: 'test' }])
    };
    
    const adapter = new ConnectorContractAdapter(mockLegacy, {
      sourceId: 'test-source',
      name: 'Test Source',
      version: '1.0.0',
      entityType: 'Aide',
      capabilities: ['REFERENCE']
    });

    const info = await adapter.discover();
    expect(info.sourceId).toBe('test-source');
    expect(info.endpoint).toBe('http://test.com');

    const result = await adapter.fetch();
    expect(result.items.length).toBe(1);
    expect(mockLegacy.fetchAll).toHaveBeenCalled();
  });

  it('factory functions exist for each migrated connector', () => {
    expect(createGrandEstContractConnector).toBeTypeOf('function');
    expect(createAgefiphContractConnector).toBeTypeOf('function');
    expect(createAidesTerritoiresContractConnector).toBeTypeOf('function');
    expect(createDreesContractConnector).toBeTypeOf('function');
    expect(createServicePublicDemarchesContractConnector).toBeTypeOf('function');
    expect(createFinessContractConnector).toBeTypeOf('function');
    expect(createRnaContractConnector).toBeTypeOf('function');
    expect(createDemarchesSimplifieesContractConnector).toBeTypeOf('function');
    expect(createMesAidesRenoContractConnector).toBeTypeOf('function');
    expect(ActualitesRssContractAdapter).toBeTypeOf('function');
    expect(StrasbourgStructuresContractAdapter).toBeTypeOf('function');
  });

  it('adapter.execute() runs the full lifecycle without errors on mock data', async () => {
    const mockLegacy = {
      baseUrl: 'http://test.com',
      fetchAll: vi.fn().mockResolvedValue([{ id: 1 }])
    };
    const adapter = new ConnectorContractAdapter(mockLegacy, {
      sourceId: 'test',
      name: 'test',
      version: '1',
      entityType: 'Aide',
      capabilities: ['REFERENCE']
    });
    
    // Test execute from ConnectorContract
    const result = await adapter.execute();
    expect(result).toBeDefined();
    expect(result.state).toBe('COMPLETE');
    expect(result.stats.fetched).toBe(1);
  });

  it('empty response safety (preserves last-known-good)', async () => {
    const mockLegacy = {
      baseUrl: 'http://test.com',
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const adapter = new ConnectorContractAdapter(mockLegacy, {
      sourceId: 'test',
      name: 'test',
      version: '1',
      entityType: 'Aide',
      capabilities: ['REFERENCE']
    });
    
    const result = await adapter.execute();
    expect(result.state).toBe('PARTIAL');
    expect(result.stats.fetched).toBe(0);
  });

  it('adapter delegates to legacy connector methods (getDetailUrls pattern)', async () => {
    const mockLegacy = {
      baseUrl: 'http://test.com',
      getDetailUrls: vi.fn().mockResolvedValue(['http://test.com/1']),
      fetch: vi.fn().mockResolvedValue('html'),
      parse: vi.fn().mockResolvedValue({ id: 1 })
    };
    const adapter = new ConnectorContractAdapter(mockLegacy, {
      sourceId: 'test',
      name: 'test',
      version: '1',
      entityType: 'Aide',
      capabilities: ['REFERENCE']
    });
    
    const result = await adapter.fetch();
    expect(mockLegacy.getDetailUrls).toHaveBeenCalled();
    expect(mockLegacy.fetch).toHaveBeenCalledWith('http://test.com/1');
    expect(mockLegacy.parse).toHaveBeenCalledWith('html', 'http://test.com/1');
    expect(result.items.length).toBe(1);
  });
});
