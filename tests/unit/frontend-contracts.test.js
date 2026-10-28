import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';

/**
 * Frontend structure contracts — vérifier la structure du frontend.
 */
describe('Frontend structure', () => {
  it('src/pages exists', () => {
    expect(existsSync('src/pages')).toBe(true);
  });

  it('has 50+ pages', () => {
    const files = readdirSync('src/pages', { recursive: true });
    const count = files.filter(f => String(f).endsWith('.jsx') || String(f).endsWith('.tsx')).length;
    expect(count).toBeGreaterThan(50);
  });

  it('src/components exists', () => {
    expect(existsSync('src/components')).toBe(true);
  });

  it('has 20+ components', () => {
    const files = readdirSync('src/components', { recursive: true });
    const count = files.filter(f => String(f).endsWith('.jsx') || String(f).endsWith('.tsx')).length;
    expect(count).toBeGreaterThan(20);
  });

  it('has App.jsx', () => {
    expect(existsSync('src/App.jsx') || existsSync('src/App.tsx')).toBe(true);
  });

  it('has main.jsx', () => {
    expect(existsSync('src/main.jsx') || existsSync('src/main.tsx')).toBe(true);
  });

  it('index.html exists', () => {
    expect(existsSync('index.html')).toBe(true);
  });
});
