/**
 * R12 (P22) — the record page's HTML template is fetched from the deployment itself, never from the request's Host header (a forged Host used to make a
 * preview instance fetch and cache another site's page, then serve it to every visitor).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('../../api/_services/page-head.js', () => ({
  loadTemplate: () => null,
  pageHead: async () => ({ status: 200, etag: 'e1' }),
  pageHeaders: () => ({ 'Content-Type': 'text/html; charset=utf-8' }),
  renderPage: (tpl) => tpl,
}));

const ENV = { ...process.env };
const mk = () => ({ statusCode: 0, body: undefined, writeHead(c) { this.statusCode = c; return this; }, end(b) { this.body = b; return this; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });
const req = { method: 'GET', query: { path: '/aides/x' }, headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } };
const TEMPLATE = '<!doctype html><div id="root"></div>';

afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); vi.resetModules(); });

describe('page template origin', () => {
  it('preview: fetched from the platform-set deployment URL, never from the forged Host', async () => {
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_URL = 'ada-git-x.vercel.app';
    const fetchSpy = vi.fn(async () => ({ ok: true, text: async () => TEMPLATE }));
    vi.stubGlobal('fetch', fetchSpy);
    const { default: handler } = await import('../../api/_handlers/public/page.js');
    const res = mk(); await handler(req, res);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://ada-git-x.vercel.app/index.html');
    expect(res.statusCode).toBe(200);
  });
  it('production: the canonical origin', async () => {
    process.env.VERCEL_ENV = 'production';
    const fetchSpy = vi.fn(async () => ({ ok: true, text: async () => TEMPLATE }));
    vi.stubGlobal('fetch', fetchSpy);
    const { default: handler } = await import('../../api/_handlers/public/page.js');
    await handler(req, mk());
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://www.accesdirectaide.fr/index.html');
  });
  it('outside the hosting: nothing is fetched (honest 503, no page from elsewhere)', async () => {
    delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { default: handler } = await import('../../api/_handlers/public/page.js');
    const res = mk(); await handler(req, res);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(String(res.body)).not.toContain('evil');
  });
});
