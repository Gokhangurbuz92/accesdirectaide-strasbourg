import { describe, it, expect, beforeAll } from 'vitest';

/**
 * API Smoke Tests — vérifications rapides que les endpoints principaux répondent.
 *
 * Ces tests utilisent le serveur de test partagé par les autres tests d'intégration.
 * Ils ne dépendent PAS d'un serveur externe.
 */

// Réutilise le helper de test existant si disponible
let apiCall;

beforeAll(async () => {
  try {
    const mod = await import('../helpers/apiCall.js');
    apiCall = mod.apiCall || mod.default;
  } catch {
    // Fallback: import direct du router
    const { createTestHandler } = await import('../helpers/testHandler.js').catch(() => ({}));
    apiCall = createTestHandler;
  }
});

describe('API Smoke Tests', () => {
  it('GET /api/health returns ok:true', async () => {
    // Health endpoint doit toujours répondre
    const mod = await import('../../api/_handlers/health.js');
    const handler = mod.default;

    const req = { method: 'GET', url: '/api/health', headers: {} };
    let statusCode = 200;
    let body = {};
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
      setHeader() { return this; },
    };

    await handler(req, res);
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('POST /api/auth/login without body returns 400+', async () => {
    const mod = await import('../../api/_handlers/auth/login.js');
    const handler = mod.default;

    const req = {
      method: 'POST',
      url: '/api/auth/login',
      headers: {},
      body: {},
    };
    let statusCode = 200;
    let body = {};
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
      setHeader() { return this; },
    };

    await handler(req, res);
    expect(statusCode).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/auth/signup rejects weak password', async () => {
    const mod = await import('../../api/_handlers/auth/signup.js');
    const handler = mod.default;

    const req = {
      method: 'POST',
      url: '/api/auth/signup',
      headers: {},
      body: { email: 'test@smoke.com', password: '123' },
    };
    let statusCode = 200;
    let body = {};
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
      setHeader() { return this; },
    };

    await handler(req, res);
    expect(statusCode).toBe(400);
    expect(body.error).toContain('faible');
  });

  it('POST /api/auth/signup rejects password without uppercase', async () => {
    const mod = await import('../../api/_handlers/auth/signup.js');
    const handler = mod.default;

    const req = {
      method: 'POST',
      url: '/api/auth/signup',
      headers: {},
      body: { email: 'test-pw@test.com', password: 'abcdefg1' },
    };
    let statusCode = 200;
    let body = {};
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
      setHeader() { return this; },
    };

    await handler(req, res);
    expect(statusCode).toBe(400);
    expect(body.details).toContain('1 majuscule requise');
  });

  it('POST /api/auth/signup rejects password without digit', async () => {
    const mod = await import('../../api/_handlers/auth/signup.js');
    const handler = mod.default;

    const req = {
      method: 'POST',
      url: '/api/auth/signup',
      headers: {},
      body: { email: 'test-pw@test.com', password: 'Abcdefgh' },
    };
    let statusCode = 200;
    let body = {};
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
      setHeader() { return this; },
    };

    await handler(req, res);
    expect(statusCode).toBe(400);
    expect(body.details).toContain('1 chiffre requis');
  });
});
