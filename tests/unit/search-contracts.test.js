import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

/**
 * Search and RAG contracts.
 */
describe('Search and RAG', () => {
  it('search handler exists', () => {
    expect(existsSync('api/_handlers/search.js')).toBe(true);
  });

  it('hybrid search module exists', () => {
    expect(existsSync('api/lib/hybrid-search.js')).toBe(true);
  });

  it('schema has embedding column', () => {
    const schema = readFileSync('src/db/schema.ts', 'utf-8');
    expect(schema).toMatch(/embedding|vector/i);
  });

  it('search utilities exist', () => {
    expect(existsSync('api/lib/search-utils.js') || existsSync('api/lib/search-cache.js')).toBe(true);
  });
});
