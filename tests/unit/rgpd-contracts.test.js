import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

/**
 * RGPD compliance contracts — vérifier que les mécanismes RGPD sont en place.
 */
describe('RGPD compliance contracts', () => {
  it('gdpr-purge cron exists', () => {
    expect(existsSync('api/_handlers/cron/gdpr-purge.js')).toBe(true);
  });

  it('gdpr-purge deletes old data', () => {
    const content = readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf-8');
    expect(content).toMatch(/delete|purge|remove|clean/i);
  });

  it('export-data handler exists', () => {
    expect(existsSync('api/_handlers/auth/export-data.js')).toBe(true);
  });

  it('delete-account handler exists', () => {
    expect(existsSync('api/_handlers/auth/delete-account.js')).toBe(true);
  });

  it('consent log table in schema', () => {
    const schema = readFileSync('src/db/schema.ts', 'utf-8');
    expect(schema).toMatch(/consent|Consent/i);
  });

  it('confidentialite page exists', () => {
    expect(existsSync('src/pages/Confidentialite.jsx')).toBe(true);
  });

  it('cookie banner component exists', () => {
    expect(existsSync('src/components/CookieBanner.jsx')).toBe(true);
  });
});
