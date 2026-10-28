import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';

/**
 * Build configuration contracts — vérifier que les configs existent.
 */
describe('Build configuration', () => {
  it('vite.config exists', () => {
    expect(existsSync('vite.config.ts') || existsSync('vite.config.js')).toBe(true);
  });

  it('tailwind.config exists', () => {
    expect(existsSync('tailwind.config.js') || existsSync('tailwind.config.ts') || existsSync('tailwind.config.cjs')).toBe(true);
  });

  it('postcss.config exists', () => {
    expect(existsSync('postcss.config.js') || existsSync('postcss.config.cjs')).toBe(true);
  });

  it('tsconfig exists', () => {
    expect(existsSync('tsconfig.json') || existsSync('tsconfig.typecheck.json')).toBe(true);
  });

  it('eslint config exists', () => {
    expect(existsSync('.eslintrc.js') || existsSync('.eslintrc.json') || existsSync('.eslintrc.cjs') || existsSync('eslint.config.js')).toBe(true);
  });
});
