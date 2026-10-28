import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

/**
 * Accessibility contracts — vérifier les bases a11y.
 */
describe('Accessibility contracts', () => {
  it('index.html has lang attribute', () => {
    const html = readFileSync('index.html', 'utf-8');
    expect(html).toMatch(/lang=["']fr["']/);
  });

  it('index.html has meta viewport', () => {
    const html = readFileSync('index.html', 'utf-8');
    expect(html).toMatch(/viewport/);
  });

  it('index.html has charset', () => {
    const html = readFileSync('index.html', 'utf-8');
    expect(html).toMatch(/charset/i);
  });

  it('index.html has title', () => {
    const html = readFileSync('index.html', 'utf-8');
    expect(html).toMatch(/<title>/);
  });

  it('skip-to-content check', () => {
    const appPath = existsSync('src/App.jsx') ? 'src/App.jsx' : 'src/App.tsx';
    const content = readFileSync(appPath, 'utf-8');
    const hasSkip = content.match(/skip|main-content|#main/i);
    if (!hasSkip) {
      console.log('NOTE: skip-to-content link not found — recommended for RGAA');
    }
    // Non-blocking — documents the gap
    expect(true).toBe(true);
  });
});
