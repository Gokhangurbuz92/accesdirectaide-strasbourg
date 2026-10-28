import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Audit trail contracts — vérifier les tables d'audit.
 */
describe('Audit trail contracts', () => {
  const schema = readFileSync('src/db/schema.ts', 'utf-8');

  it('AuditLog table exists', () => {
    expect(schema).toMatch(/AuditLog/);
  });

  it('ProAuditLog table exists', () => {
    expect(schema).toMatch(/ProAuditLog/);
  });

  it('ConsentLog table exists', () => {
    expect(schema).toMatch(/ConsentLog/);
  });

  it('IngestJob table exists', () => {
    expect(schema).toMatch(/IngestJob/);
  });

  it('EntityVersion table exists', () => {
    expect(schema).toMatch(/EntityVersion/);
  });

  it('SyncRun table exists', () => {
    expect(schema).toMatch(/SyncRun/);
  });
});
