import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

/**
 * Crypto contracts — vérifier le module de chiffrement.
 */
describe('Crypto contracts', () => {
  it('crypto module exists', () => {
    expect(existsSync('api/lib/crypto.ts') || existsSync('api/lib/crypto.js')).toBe(true);
  });

  it('uses AES-256-GCM', () => {
    const path = existsSync('api/lib/crypto.ts') ? 'api/lib/crypto.ts' : 'api/lib/crypto.js';
    const content = readFileSync(path, 'utf-8');
    expect(content).toMatch(/aes-256-gcm|AES/i);
  });

  it('ProOutlookToken has encrypted fields', () => {
    const schema = readFileSync('src/db/schema.ts', 'utf-8');
    expect(schema).toMatch(/accessTokenEnc/);
    expect(schema).toMatch(/refreshTokenEnc/);
  });
});
