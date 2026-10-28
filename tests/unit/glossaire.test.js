import { describe, it, expect } from 'vitest';
import { GLOSSAIRE } from '../../api/lib/glossaire.js';

describe('Glossaire', () => {
  it('has 15+ termes', () => {
    expect(GLOSSAIRE.length).toBeGreaterThan(15);
  });

  it('all termes have required fields', () => {
    GLOSSAIRE.forEach((g) => {
      expect(g.terme).toBeDefined();
      expect(g.terme.length).toBeGreaterThan(1);
      expect(g.definition).toBeDefined();
      expect(g.definition.length).toBeGreaterThan(10);
      expect(g.categorie).toBeDefined();
    });
  });

  it('termes are unique', () => {
    const termes = GLOSSAIRE.map((g) => g.terme);
    const unique = [...new Set(termes)];
    expect(unique.length).toBe(termes.length);
  });

  it('has common acronyms', () => {
    const termes = GLOSSAIRE.map((g) => g.terme);
    expect(termes).toContain('RSA');
    expect(termes).toContain('APL');
    expect(termes).toContain('AAH');
    expect(termes).toContain('CAF');
  });

  it('all links are valid paths', () => {
    GLOSSAIRE.filter((g) => g.lien).forEach((g) => {
      expect(g.lien).toMatch(/^\//);
    });
  });

  it('covers multiple categories', () => {
    const cats = [...new Set(GLOSSAIRE.map((g) => g.categorie))];
    expect(cats.length).toBeGreaterThan(5);
  });
});
