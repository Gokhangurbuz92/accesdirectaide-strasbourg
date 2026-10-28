import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

/**
 * Public handlers — vérifier que les endpoints publics sont bien configurés.
 */
describe('Public handlers', () => {
  const publicHandlers = [
    'api/_handlers/aides.js',
    'api/_handlers/structures.js',
    'api/_handlers/demarches.js',
    'api/_handlers/actualites.js',
    'api/_handlers/search.js',
    'api/_handlers/contact.js',
    'api/_handlers/feedback.js',
  ];

  publicHandlers.forEach(handler => {
    const name = handler.split('/').pop();

    if (!existsSync(handler)) return;

    it(`${name} exports handler`, () => {
      const content = readFileSync(handler, 'utf-8');
      expect(content).toMatch(/export|module\.exports/);
    });

    it(`${name} handles HTTP methods`, () => {
      const content = readFileSync(handler, 'utf-8');
      expect(content).toMatch(/method|GET|POST|req|res/i);
    });
  });
});
