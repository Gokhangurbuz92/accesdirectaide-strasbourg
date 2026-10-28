/**
 * Launch-readiness item 56 — the maintenance switch the runbooks rely on: MAINTENANCE_MODE=1 makes every page answer 503 (Retry-After, not cached, emergency
 * numbers on it); without it the middleware behaves as before. The API is outside the middleware's matcher (unchanged).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware, { config, MAINTENANCE_HTML } from '../../middleware.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('maintenance mode', () => {
  it('MAINTENANCE_MODE=1: every page answers 503 with the maintenance page', async () => {
    vi.stubEnv('MAINTENANCE_MODE', '1'); vi.stubEnv('VERCEL_ENV', 'production');
    const r = middleware(new Request('https://www.accesdirectaide.fr/aides', { headers: { host: 'www.accesdirectaide.fr' } }));
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('3600');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const html = await r.text();
    expect(html).toContain('Le site est en maintenance');
    for (const n of ['15', '112', '115', '119', '3919']) expect(html).toContain(`<strong>${n}</strong>`);
  });
  it('off by default: the page goes through (and a preview stays noindex)', () => {
    vi.stubEnv('MAINTENANCE_MODE', ''); vi.stubEnv('VERCEL_ENV', 'preview');
    const r = middleware(new Request('https://x.vercel.app/aides', { headers: { host: 'x.vercel.app' } }));
    expect(r.status).not.toBe(503);
    expect(r.headers.get('x-robots-tag') || r.headers.get('x-middleware-request-x-robots-tag') || JSON.stringify([...r.headers])).toMatch(/noindex/);
  });
  it('the API and the static files are not matched', () => {
    expect(config.matcher[0]).toMatch(/\(\?!api\//);
    expect(MAINTENANCE_HTML).not.toMatch(/<script/i);
  });
});
