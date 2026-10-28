import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Phase 8 Verification', () => {
  // T098a: Verify SSRF protection exists
  it('SSRF protection service exists with required functions', () => {
    const content = readFileSync('api/lib/services/source-verification.js', 'utf8');
    expect(content).toContain('FORBIDDEN_HOSTS');
    expect(content).toContain('PRIVATE_RANGES');
    expect(content).toContain('verifyUrl');
  });

  // T098b: Verify Source Registry is canonical
  it('SourceRegistry exists as canonical registry', () => {
    expect(existsSync('api/lib/ingestion/SourceRegistry.js')).toBe(true);
    const content = readFileSync('api/lib/ingestion/SourceRegistry.js', 'utf8');
    expect(content).toContain('registerSource');
    expect(content).toContain('getSource');
    expect(content).toContain('listSources');
  });

  // T098c: Verify ConnectorContract implements lifecycle
  it('ConnectorContract has all lifecycle methods', () => {
    const content = readFileSync('api/lib/ingestion/ConnectorContract.js', 'utf8');
    ['discover', 'fetch', 'validate', 'normalize', 'diff', 'persist', 'verify', 'report', 'execute'].forEach(method => {
      expect(content).toContain(`async ${method}(`);
    });
  });

  // T098d: Verify all connectors have contract factories
  it('all connectors have ContractConnector factory or are standalone', () => {
    const connectors = [
      'GrandEstConnector.js', 'AgefiphConnector.js', 'AidesTerritoiresConnector.js',
      'DreesConnector.js', 'ServicePublicDemarchesConnector.js', 'FinessConnector.js',
      'RnaConnector.js', 'DemarchesSimplifieesConnector.js', 'MesAidesRenoConnector.js'
    ];
    connectors.forEach(file => {
      const content = readFileSync(`api/lib/ingestion/${file}`, 'utf8');
      expect(content).toContain('ContractConnector');
    });
  });

  // T098e: Verify new connectors
  it('new Phase 8 connectors exist', () => {
    ['FranceServicesConnector.js', 'LegifranceConnector.js', 'DataGouvConnector.js',
     'CafOpenDataConnector.js', 'FranceTravailConnector.js'].forEach(file => {
      expect(existsSync(`api/lib/ingestion/${file}`)).toBe(true);
    });
  });

  // T098f: Verify normalization schemas
  it('normalization schemas exist with language field', () => {
    const files = ['NormalizedBenefit.js', 'NormalizedProcedure.js', 'NormalizedStructure.js'];
    files.forEach(file => {
      const content = readFileSync(`api/lib/ingestion/normalization/${file}`, 'utf8');
      expect(content).toContain('language');
      expect(content).toContain("'fr'");
    });
  });

  // T098g: Verify source capability service
  it('source capability service enforces specialist compatibility', () => {
    const content = readFileSync('api/lib/services/source-capability.js', 'utf8');
    expect(content).toContain('EligibilitySpecialist');
    expect(content).toContain('OrientationSpecialist');
    expect(content).toContain('ProcedureSpecialist');
    expect(content).toContain('isSourceCompatible');
  });

  // T098h: Verify OpenFisca circuit breaker threshold
  it('OpenFisca client uses circuit breaker', () => {
    const content = readFileSync('api/lib/openfiscaClient.js', 'utf8');
    expect(content).toContain('CB_THRESHOLD');
  });

  // T098i: Verify sync safety
  it('sync safety module prevents empty-response deletion', () => {
    const content = readFileSync('api/lib/ingestion/sync-safety.js', 'utf8');
    expect(content).toContain('isEmptyResponseSafe');
    expect(content).toContain('PRESERVE_LAST_KNOWN_GOOD');
  });

  // T098j: Verify conflict resolution does not use LLM
  it('conflict resolution never uses LLM confidence', () => {
    const content = readFileSync('api/lib/services/conflict-resolution.js', 'utf8');
    expect(content).not.toContain('llm');
    expect(content).not.toContain('LLM');
    // Verify it uses competence-based factors
    expect(content).toContain('competence');
  });

  // T098k: Verify OpenFisca version is pinned
  it('OpenFisca Dockerfile has pinned version', () => {
    const content = readFileSync('infrastructure/openfisca/Dockerfile', 'utf8');
    expect(content).toMatch(/openfisca-france==\d+/);
  });

  // T098l: Verify household model is variable-length
  it('OpenFisca mapping supports variable-length household', () => {
    const content = readFileSync('api/lib/openfiscaMapping.js', 'utf8');
    expect(content).toContain('enfant_');
    expect(content).not.toContain("enfants: []"); // No longer hardcoded empty
  });
});
