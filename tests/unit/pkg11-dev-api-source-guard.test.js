/**
 * PKG-11 audit (RC23 native run 20261022T234857Z-b2e968): in sandbox / mock runs (no API proxy) the Vite dev server served /api/monitor/pro-rdv as the transformed SERVER
 * module, and its server-only imports made it re-optimize dependencies and reload the open page in the middle of the mock suite. The guard sends any /api path that
 * matches a server file to the same handling as every other /api path; nothing else is touched. The cookie-banner offset is set before the first paint and the
 * assistant button no longer animates its position (DTA-B54 measured it mid-transition).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const loadConfig = async () => { vi.resetModules(); return (await import('../../vite.config.js')).default; };   // the config reads the environment when it loads
const guardOf = async () => {
  const plugin = (await loadConfig()).plugins.flat().find((p) => p && p.name === 'accesdirectaide-api-source-guard');
  let middleware = null; plugin.configureServer({ middlewares: { use: (fn) => { middleware = fn; } } });
  return (url) => { const req = { url }; let passed = false; middleware(req, {}, () => { passed = true; }); return { url: req.url, passed }; };
};

describe('dev server API source guard (sandbox mode)', () => {
  const saved = process.env.ADA_STAGE6_SANDBOX;
  afterEach(() => { if (saved === undefined) delete process.env.ADA_STAGE6_SANDBOX; else process.env.ADA_STAGE6_SANDBOX = saved; });

  it('replaces the API proxy in sandbox mode only', async () => {
    process.env.ADA_STAGE6_SANDBOX = '1';
    const names = (await loadConfig()).plugins.flat().filter(Boolean).map((p) => p.name);
    expect(names).toContain('accesdirectaide-api-source-guard'); expect(names).not.toContain('accesdirectaide-api-proxy');
    delete process.env.ADA_STAGE6_SANDBOX;
    const dev = (await loadConfig()).plugins.flat().filter(Boolean).map((p) => p.name);
    expect(dev).toContain('accesdirectaide-api-proxy'); expect(dev).not.toContain('accesdirectaide-api-source-guard');
  });

  it('a path that matches a server file is never resolved to it; every other request is untouched', async () => {
    process.env.ADA_STAGE6_SANDBOX = '1';
    const guard = await guardOf();
    for (const u of ['/api/monitor/pro-rdv', '/api/routes', '/api/index.js', '/api/monitor/pro-rdv?x=1']) {
      const out = guard(u); expect(out.passed).toBe(true); expect(out.url.startsWith('/__api_source_not_served__/api/')).toBe(true);
    }
    for (const u of ['/api/health', '/api/aides?q=x', '/aides', '/src/main.jsx', '/', '/apiary']) expect(guard(u)).toEqual({ url: u, passed: true });
  });

  it('the banner offset is set before paint and the assistant button does not animate its position', () => {
    expect(readFileSync('src/components/CookieBanner.jsx', 'utf8')).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!visible \|\| !ref\.current/);
    const fab = readFileSync('src/components/chat/ChatAssistant.jsx', 'utf8').split('\n').find((l) => l.includes('bottom-[calc(1.5rem+var(--cookie-banner-offset'));
    expect(fab).toMatch(/transition-\[background-color,transform\]/); expect(fab).not.toMatch(/transition-all/);
  });
});
