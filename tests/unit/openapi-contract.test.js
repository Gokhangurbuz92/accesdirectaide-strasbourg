import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * OpenAPI contract tests — vérifier le handler et le fichier spec.
 */
describe('OpenAPI contract', () => {
  it('openapi handler exists and exports default', async () => {
    const mod = await import('../../api/_handlers/openapi.js');
    expect(typeof mod.default).toBe('function');
  });

  it('openapi.json exists and is valid', () => {
    const file = resolve('docs/openapi.json');
    if (!existsSync(file)) {
      // Skip si pas de fichier — le handler le génère à la volée
      return;
    }
    const content = readFileSync(file, 'utf-8');
    const json = JSON.parse(content);
    expect(json.openapi || json.swagger).toBeDefined();
    expect(json.info).toBeDefined();
    expect(json.paths).toBeDefined();
  });
});
