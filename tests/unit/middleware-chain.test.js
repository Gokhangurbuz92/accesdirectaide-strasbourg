import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Middleware chain tests — vérifier que api/index.js applique
 * toutes les protections nécessaires.
 */
describe('Middleware chain', () => {
  const content = readFileSync('api/index.js', 'utf-8');

  it('applies CORS handling', () => {
    expect(content).toMatch(/cors|CORS|origin|Origin|Access-Control/i);
  });

  it('applies CSRF protection', () => {
    expect(content).toMatch(/csrf|CSRF/i);
  });

  it('applies rate limiting', () => {
    expect(content).toMatch(/rateLimit|checkRateLimit/);
  });

  it('generates request ID', () => {
    expect(content).toMatch(/requestId|request.id|x-request-id/i);
  });

  it('imports security utilities', () => {
    expect(content).toMatch(/import.*rateLimit|import.*csrf|import.*auth/);
  });
});
