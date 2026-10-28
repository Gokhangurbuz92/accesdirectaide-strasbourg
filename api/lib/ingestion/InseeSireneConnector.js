// @ts-nocheck
import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';

export function createInseeSireneContractConnector() {
  const legacyShim = {
    name: 'insee-sirene',
    baseUrl: 'https://api.insee.fr/entreprises/sirene/V3',
    getDetailUrls: async () => [],
    fetch: async () => '',
    parse: async () => null,
    getStableId: (item) => item.siret || item.siren
  };
  return new ConnectorContractAdapter(legacyShim, {
    sourceId: 'insee-sirene',
    name: 'INSEE Sirene API',
    version: '1.0.0',
    entityType: 'Structure',
    capabilities: ['REFERENCE']
  });
}
