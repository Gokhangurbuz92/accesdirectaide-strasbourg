import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Redirects and SPA configuration.
 */
describe('Redirects configuration', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf-8'));

  it('has redirects configured', () => {
    expect(config.redirects?.length || 0).toBeGreaterThan(0);
  });

  it('has rewrites configured', () => {
    expect(config.rewrites?.length || 0).toBeGreaterThan(0);
  });

  it('has SPA fallback to index.html', () => {
    const all = JSON.stringify(config);
    expect(all).toMatch(/index\.html|dest.*\//);
  });
});
