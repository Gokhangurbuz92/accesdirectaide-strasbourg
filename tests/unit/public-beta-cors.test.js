/**
 * Public beta (owner directive 29/10/2026): the API trusts the two production hostnames and the deployment's own APP_BASE_URL origin only.
 * The deleted legacy Vercel project's hostnames are no longer trusted (a deleted project's name could be claimed by someone else).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

const preflight = async (origin) => {
  vi.resetModules();
  const { default: handler } = await import('../../api/index.js');
  const headers = {};
  const res = {
    statusCode: 200, headersSent: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, removeHeader(k) { delete headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, json() { this.headersSent = true; return this; }, send() { this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; }, on() { return this; }, once() { return this; },
  };
  await handler({ method: 'OPTIONS', url: '/api/health', headers: { host: 'x', origin }, query: {}, cookies: {} }, res);
  return headers['access-control-allow-origin'];
};

describe('public beta CORS origins', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });
  it('trusts the production hostnames and the exact APP_BASE_URL origin', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://accesdirectaide-strasbourg.vercel.app/');
    expect(await preflight('https://www.accesdirectaide.fr')).toBe('https://www.accesdirectaide.fr');
    expect(await preflight('https://accesdirectaide-strasbourg.vercel.app')).toBe('https://accesdirectaide-strasbourg.vercel.app');
  });
  it('no longer trusts the deleted legacy project, other vercel.app hosts or look-alikes', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://accesdirectaide-strasbourg.vercel.app');
    for (const o of ['https://acces-direct-aide-b6066dd3.vercel.app', 'https://acces-direct-aide-b6066dd3-abc123.vercel.app', 'https://accesdirectaide-strasbourg-git-x.vercel.app',
      'https://accesdirectaide-strasbourg.vercel.app.evil.com', 'http://accesdirectaide-strasbourg.vercel.app', 'https://evil.com']) expect(await preflight(o), o).toBeUndefined();
  });
  it('ignores a non-https or invalid APP_BASE_URL', async () => {
    vi.stubEnv('APP_BASE_URL', 'http://insecure.example');
    expect(await preflight('http://insecure.example')).toBeUndefined();
    vi.stubEnv('APP_BASE_URL', 'not a url');
    expect(await preflight('https://evil.com')).toBeUndefined();
  });
});
