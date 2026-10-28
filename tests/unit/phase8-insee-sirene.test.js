import { describe, it, expect } from 'vitest';
import { createInseeSireneContractConnector } from '../../api/lib/ingestion/InseeSireneConnector.js';

describe('Phase 8 InseeSireneConnector', () => {
  it('creates contract connector with correct capabilities', () => {
    const connector = createInseeSireneContractConnector();
    expect(connector.metadata.sourceId).toBe('insee-sirene');
    expect(connector.metadata.capabilities).toContain('REFERENCE');
    expect(connector.metadata.entityType).toBe('Structure');
  });
});
