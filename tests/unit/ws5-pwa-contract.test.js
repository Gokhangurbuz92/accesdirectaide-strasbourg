import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const swPath = path.join(root, 'public/sw.js');
const mainPath = path.join(root, 'src/main.jsx');

function loadServiceWorkerContext() {
  const source = fs.readFileSync(swPath, 'utf8');
  const listeners = new Map();

  const context = {
    URL,
    Promise,
    console,
    self: {
      location: { origin: 'https://ada.local' },
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
    },
    caches: {
      open: async () => ({
        match: async () => undefined,
        put: async () => undefined,
        addAll: async () => undefined,
      }),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async () => {
      throw new Error('fetch not expected in contract unit test');
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  return { context, listeners };
}

function request(pathname, options = {}) {
  const headers = new Map(
    Object.entries(options.headers || {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );

  return {
    method: options.method || 'GET',
    url: options.url || `https://ada.local${pathname}`,
    mode: options.mode || 'cors',
    headers: {
      get(name) {
        return headers.get(String(name).toLowerCase()) || null;
      },
    },
  };
}

describe('WS5 static-only service worker contract', () => {
  it('registers install, activate and fetch handlers', () => {
    const { listeners } = loadServiceWorkerContext();

    expect(listeners.has('install')).toBe(true);
    expect(listeners.has('activate')).toBe(true);
    expect(listeners.has('fetch')).toBe(true);
  });

  it.each([
    '/api/aides',
    '/uploads/citizen.pdf',
    '/documents/private.pdf',
    '/dossiers/123',
    '/compte',
    '/compte/messages',
    '/pro/dossiers',
    '/admin',
    '/auth/session',
  ])('bypasses prohibited route %s', (pathname) => {
    const { context } = loadServiceWorkerContext();

    expect(context.shouldBypass(request(pathname))).toBe(true);
    expect(context.isStaticAssetRequest(request(pathname))).toBe(false);
  });

  it('bypasses non-GET, auth and CSRF-bearing requests', () => {
    const { context } = loadServiceWorkerContext();

    expect(context.shouldBypass(request('/assets/app.js', { method: 'POST' }))).toBe(true);
    expect(
      context.shouldBypass(
        request('/assets/app.js', { headers: { authorization: 'Bearer secret' } })
      )
    ).toBe(true);
    expect(
      context.shouldBypass(
        request('/assets/app.js', { headers: { 'x-csrf-token': 'token' } })
      )
    ).toBe(true);
  });

  it('bypasses every cross-origin request', () => {
    const { context } = loadServiceWorkerContext();

    expect(
      context.shouldBypass(
        request('/asset.js', { url: 'https://example.invalid/asset.js' })
      )
    ).toBe(true);
  });

  it('permits only declared static asset paths for runtime caching', () => {
    const { context } = loadServiceWorkerContext();

    expect(context.isStaticAssetRequest(request('/assets/app-123.js'))).toBe(true);
    expect(context.isStaticAssetRequest(request('/icons/icon-192.png'))).toBe(true);
    expect(context.isStaticAssetRequest(request('/manifest.json'))).toBe(true);
    expect(context.isStaticAssetRequest(request('/aides'))).toBe(false);
    expect(context.isStaticAssetRequest(request('/demarches'))).toBe(false);
    expect(context.isStaticAssetRequest(request('/orientation'))).toBe(false);
  });

  it('does not cache private/no-store responses', () => {
    const { context } = loadServiceWorkerContext();

    const response = (cacheControl) => ({
      ok: true,
      type: 'basic',
      headers: { get: () => cacheControl },
    });

    expect(context.responseMayBeCached(response('private, max-age=60'))).toBe(false);
    expect(context.responseMayBeCached(response('no-store'))).toBe(false);
    expect(context.responseMayBeCached(response('public, max-age=31536000'))).toBe(true);
  });

  it('registers /sw.js only for production builds', () => {
    const main = fs.readFileSync(mainPath, 'utf8');

    expect(main).toContain('WS5_STATIC_PWA_REGISTRATION_BEGIN');
    expect(main).toContain('import.meta.env.PROD');
    expect(main).toContain(".register('/sw.js', { scope: '/' })");
  });
});
