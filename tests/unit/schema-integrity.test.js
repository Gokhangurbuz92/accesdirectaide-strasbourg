import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';

/**
 * Schema integrity tests — vérifier que le schema DB exporte
 * toutes les tables attendues et que les migrations existent.
 */
describe('Schema integrity', () => {
  let schema;

  it('loads schema without error', async () => {
    schema = await import('../../src/db/schema.js');
    expect(schema).toBeDefined();
  });

  it('exports core citizen tables', () => {
    expect(schema.CitizenUser).toBeDefined();
    expect(schema.ConversationLog).toBeDefined();
    expect(schema.AuditLog).toBeDefined();
  });

  it('exports core data tables', () => {
    expect(schema.Aide).toBeDefined();
    expect(schema.Structure).toBeDefined();
    expect(schema.Demarche).toBeDefined();
    expect(schema.Actualite).toBeDefined();
  });

  it('exports admin and pro tables', () => {
    expect(schema.AdminUser).toBeDefined();
    expect(schema.ProUser).toBeDefined();
    expect(schema.AiMetric).toBeDefined();
  });

  it('has 30+ exported symbols', () => {
    const exportCount = Object.keys(schema).filter(k =>
      !k.startsWith('_') && typeof schema[k] !== 'function'
    ).length;
    expect(exportCount).toBeGreaterThan(30);
  });

  it('drizzle.config.ts exists', () => {
    expect(existsSync('drizzle.config.ts')).toBe(true);
  });

  it('migrations directory has files', () => {
    expect(existsSync('drizzle')).toBe(true);
    expect(existsSync('drizzle/meta')).toBe(true);
  });
});
