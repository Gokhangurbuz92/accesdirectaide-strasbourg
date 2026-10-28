import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

describe('Search and filters', () => {
  it('search handler exists', () => {
    expect(existsSync('api/_handlers/search.js')).toBe(true);
  });

  it('search uses hybrid approach', () => {
    const content = readFileSync('api/_handlers/search.js', 'utf-8');
    expect(content).toMatch(/hybrid|vector|embedding|tsvector/i);
  });

  it('search integrates glossaire', () => {
    const content = readFileSync('api/_handlers/search.js', 'utf-8');
    expect(content).toContain('GLOSSAIRE');
    expect(content).toContain("type: 'glossaire'");
  });

  it('aides handler supports category filter', () => {
    const content = readFileSync('api/_handlers/aides.js', 'utf-8');
    expect(content).toMatch(/category|categorie/i);
  });

  it('aides handler supports audience filter', () => {
    const content = readFileSync('api/lib/search-query.js', 'utf-8');
    expect(content).toContain('audiences');
  });

  it('aides handler supports urgence filter', () => {
    const content = readFileSync('api/lib/search-query.js', 'utf-8');
    expect(content).toContain('est_urgent');
  });

  it('structures handler supports type filter', () => {
    const content = readFileSync('api/_handlers/structures.js', 'utf-8');
    expect(content).toMatch(/type|categorie/i);
  });

  it('glossaire handler exists', () => {
    expect(existsSync('api/_handlers/glossaire.js')).toBe(true);
  });

  it('glossaire data exists', () => {
    expect(existsSync('api/lib/glossaire.js')).toBe(true);
  });

  it('glossaire page exists', () => {
    expect(existsSync('src/pages/Glossaire.jsx')).toBe(true);
  });

  it('glossaire route is registered', () => {
    const content = readFileSync('api/routes.js', 'utf-8');
    expect(content).toContain("'glossaire'");
  });

  it('glossaire frontend route exists', () => {
    const content = readFileSync('src/pages/index.jsx', 'utf-8');
    expect(content).toContain('/glossaire');
    expect(content).toContain('Glossaire');
  });

  it('aides page links to glossaire', () => {
    const content = readFileSync('src/pages/Aides.jsx', 'utf-8');
    expect(content).toContain('/glossaire');
  });

  it('urgence filter uses API param', () => {
    const content = readFileSync('src/pages/Aides.jsx', 'utf-8');
    expect(content).toContain("urgentOnly ? 'true' : undefined");
    expect(content).not.toContain('urgent: false');
  });
});
