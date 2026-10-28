import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';

/**
 * Ingestion connectors — vérifier que tous les connecteurs existent et exportent.
 */
describe('Ingestion connectors', () => {
  const ingestionDir = 'api/lib/ingestion';

  it('ingestion directory exists', () => {
    expect(existsSync(ingestionDir)).toBe(true);
  });

  it('has 10+ connectors', () => {
    const files = readdirSync(ingestionDir).filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('each connector exports', () => {
    const files = readdirSync(ingestionDir).filter(f => f.endsWith('.js'));
    files.forEach(f => {
      const content = readFileSync(`${ingestionDir}/${f}`, 'utf-8');
      expect(content).toMatch(/export|module\.exports/);
    });
  });

  it('has AidesTerritoiresConnector', () => {
    expect(existsSync(`${ingestionDir}/AidesTerritoiresConnector.js`)).toBe(true);
  });

  it('has DreesConnector', () => {
    expect(existsSync(`${ingestionDir}/DreesConnector.js`)).toBe(true);
  });

  it('has FinessConnector', () => {
    expect(existsSync(`${ingestionDir}/FinessConnector.js`)).toBe(true);
  });
});
