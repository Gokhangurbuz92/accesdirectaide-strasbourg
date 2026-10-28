import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Handler contracts — vérifier que tous les handlers API sont valides.
 */
function getHandlerFiles(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getHandlerFiles(path));
    } else if (entry.name.endsWith('.js') && !entry.name.includes('.test.')) {
      files.push(path);
    }
  }
  return files;
}

describe('Handler contracts', () => {
  const handlersDir = resolve('api/_handlers');
  const handlers = getHandlerFiles(handlersDir);

  it('has 100+ handlers', () => {
    expect(handlers.length).toBeGreaterThan(100);
  });

  it('all handlers are .js files', () => {
    handlers.forEach(h => {
      expect(h).toMatch(/\.js$/);
    });
  });

  it('no handler is empty', () => {
    handlers.forEach(h => {
      const content = readFileSync(h, 'utf-8');
      expect(content.length).toBeGreaterThan(10);
    });
  });

  it('all handlers contain export', () => {
    handlers.forEach(h => {
      const content = readFileSync(h, 'utf-8');
      const hasExport = content.includes('export default') ||
        content.includes('module.exports') ||
        content.includes('export function') ||
        content.includes('export async function') ||
        content.includes('export const') ||
        content.includes('export {');
      expect(hasExport, `${h} should have an export`).toBe(true);
    });
  });
});
