import { describe, it, expect } from 'vitest';

/**
 * Routes registry tests — vérifier que le routeur API charge correctement
 * et contient les catégories de routes attendues.
 */
describe('Routes registry', () => {
  let routes;

  it('loads routes.js without error', async () => {
    const mod = await import('../../api/routes.js');
    routes = mod.default || mod.routes || mod;
    expect(routes).toBeDefined();
  });

  it('is an array with 100+ routes', () => {
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(100);
  });

  it('each route has a path property', () => {
    for (const route of routes) {
      expect(route).toHaveProperty('path');
    }
  });

  it('has download route', () => {
    expect(routes.some(r => r.path === 'download')).toBe(true);
  });
});
