import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';

/**
 * OpenAPI specification tests.
 */
describe('OpenAPI specification', () => {
  it('openapi handler exists', () => {
    expect(existsSync('api/_handlers/openapi.js')).toBe(true);
  });

  it('openapi handler exports', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync('api/_handlers/openapi.js', 'utf-8');
    expect(content).toMatch(/export|module\.exports/);
  });
});
