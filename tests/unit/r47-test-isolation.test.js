/**
 * R47 (tooling) — LAB / test isolation. R46: a worker's mock run reached the owner's LAB on :3000 through the Vite dev proxy (hard-coded localhost:3000).
 * The dev proxy target is now explicit and validated, and the LAB harness servers share one guard (scripts/lib/test-isolation.mjs): loopback host,
 * port ≠ 3000, the disposable test cluster 127.0.0.1:55434 with a *_test database, never Neon or another remote host. No server is started here: each
 * harness is run with a refused configuration and must stop before it loads the API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { assertTestServer, assertTestDatabaseUrl, isTestContext, resolveDevApiTarget, testContextSignals } from '../../scripts/lib/test-isolation.mjs';

const TEST_DB = 'postgres://ada_test@127.0.0.1:55434/ada_r47_tooling_test';

describe('R47 test-context detection', () => {
  it('names the signals; the owner\'s plain `npm run dev` environment has none', () => {
    expect(testContextSignals({})).toEqual([]);
    expect(isTestContext({ NODE_ENV: 'development' })).toBe(false);
    expect(isTestContext({ CI: 'false', VITEST: '' })).toBe(false);
    expect(testContextSignals({ PLAYWRIGHT_TEST: '1', CI: 'true', VITEST: 'true', ADA_TEST_ISOLATION: '1', NODE_ENV: 'test', VITE_USE_MOCKS: 'true' }))
      .toEqual(['PLAYWRIGHT_TEST', 'CI', 'VITEST', 'ADA_TEST_ISOLATION', 'NODE_ENV=test', 'VITE_USE_MOCKS']);
  });
});

describe('R47 Vite dev proxy target', () => {
  it('keeps the owner\'s default (localhost:3000) outside tests, and an explicit loopback override', () => {
    expect(resolveDevApiTarget({})).toMatchObject({ ok: true, hostname: 'localhost', port: 3000 });
    expect(resolveDevApiTarget({ VITE_DEV_API_TARGET: 'http://127.0.0.1:5191' })).toMatchObject({ ok: true, hostname: '127.0.0.1', port: 5191 });
    expect(resolveDevApiTarget({ VITE_DEV_API_TARGET: 'http://127.0.0.1:3000' })).toMatchObject({ ok: true, port: 3000 });
  });
  it('in a test context refuses :3000 — by default and explicitly — and accepts a loopback non-3000 target', () => {
    for (const env of [{ CI: 'true' }, { PLAYWRIGHT_TEST: '1' }, { VITEST: 'true' }, { ADA_TEST_ISOLATION: '1' }, { NODE_ENV: 'test' }, { USE_MOCKS: 'true' }]) {
      expect(resolveDevApiTarget(env)).toMatchObject({ ok: false });
      expect(resolveDevApiTarget({ ...env, VITE_DEV_API_TARGET: 'http://localhost:3000' })).toMatchObject({ ok: false });
      expect(resolveDevApiTarget({ ...env, VITE_DEV_API_TARGET: 'http://127.0.0.1:5191' })).toMatchObject({ ok: true, port: 5191 });
    }
  });
  it('refuses a non-loopback, non-http, port-less or malformed target in every context', () => {
    for (const t of ['http://192.168.1.10:5191', 'https://127.0.0.1:5191', 'http://127.0.0.1', 'http://example.test:5191', 'not a url', 'http://127.0.0.1.example.test:5191']) {
      expect(resolveDevApiTarget({ VITE_DEV_API_TARGET: t }).ok).toBe(false);
    }
  });

  describe('the plugin of vite.config.js', () => {
    const keys = ['CI', 'VITE_DEV_API_TARGET', 'ADA_STAGE6_SANDBOX', 'ADA_TEST_ISOLATION'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
    const proxyMiddleware = async () => {
      vi.resetModules();
      const plugin = (await import('../../vite.config.js')).default.plugins.flat().find((p) => p && p.name === 'accesdirectaide-api-proxy');
      let mw = null; plugin.configureServer({ middlewares: { use: (fn) => { mw = fn; } } });
      return mw;
    };
    it('in a test context answers 503 itself for /api, robots and sitemap (no request leaves it), and passes other paths on', async () => {
      delete process.env.ADA_STAGE6_SANDBOX; delete process.env.VITE_DEV_API_TARGET; process.env.ADA_TEST_ISOLATION = '1';
      const mw = await proxyMiddleware();
      for (const url of ['/api/health', '/robots.txt', '/sitemap.xml']) {
        const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = String(b); } };
        let passed = false;
        await mw({ url, method: 'GET', headers: {} }, res, () => { passed = true; });
        expect(passed).toBe(false); expect(res.code).toBe(503); expect(JSON.parse(res.body).error).toBe('API Dev Proxy Refused');
      }
      let passed = false; await mw({ url: '/aides', headers: {} }, {}, () => { passed = true; }); expect(passed).toBe(true);
    });
  });
});

describe('R47 test server guard', () => {
  it('accepts loopback, a non-3000 port and the test cluster database', () => {
    expect(() => assertTestServer({ host: '127.0.0.1', port: 5191, databaseUrl: TEST_DB })).not.toThrow();
    expect(() => assertTestServer({ port: 5191, requireDatabase: false })).not.toThrow();
  });
  it('refuses port 3000, a non-loopback host, an invalid port and a missing database (unless optional)', () => {
    expect(() => assertTestServer({ port: 3000, databaseUrl: TEST_DB })).toThrow(/owner LAB/);
    expect(() => assertTestServer({ host: '0.0.0.0', port: 5191, databaseUrl: TEST_DB })).toThrow(/not loopback/);
    expect(() => assertTestServer({ port: 'x', databaseUrl: TEST_DB })).toThrow(/invalid port/);
    expect(() => assertTestServer({ port: 5191 })).toThrow(/DATABASE_URL missing/);
  });
  it('refuses Neon / remote hosts, another port, a name without _test, a host override, a non-PostgreSQL URL', () => {
    for (const u of [
      'postgres://u@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb_test?sslmode=require',
      'postgres://u@db.example.test:55434/ada_x_test',
      'postgres://u@127.0.0.1:5432/ada_x_test',
      'postgres://u@127.0.0.1/ada_x_test',
      'postgres://u@127.0.0.1:55434/ada_lab',
      'postgres://u@127.0.0.1:55434/ada_test_prod',
      'postgres://u@127.0.0.1:55434/ada_x_test?host=db.example.test',
      'mysql://u@127.0.0.1:55434/ada_x_test',
      'nonsense',
    ]) expect(() => assertTestDatabaseUrl(u), u).toThrow();
  });
});

describe('R47 harness servers stop before loading the API on a refused configuration', () => {
  const run = (/** @type {string} */ file, /** @type {Record<string, string>} */ env) => spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000, env: { PATH: String(process.env.PATH), HOME: String(process.env.HOME), ...env } });
  it('e2e-r46/pro/serve.mjs', () => {
    expect(run('e2e-r46/pro/serve.mjs', { R46_PRO_PORT: '3000', DATABASE_URL: TEST_DB }).stderr).toMatch(/owner LAB/);
    expect(run('e2e-r46/pro/serve.mjs', { R46_PRO_PORT: '5191', DATABASE_URL: 'postgres://u@ep-x.eu-central-1.aws.neon.tech/neondb' }).stderr).toMatch(/remote\/managed database host refused/);
    expect(run('e2e-r46/pro/serve.mjs', { R46_PRO_PORT: '5191', DATABASE_URL: 'postgres://u@127.0.0.1:55434/ada_lab' }).stderr).toMatch(/must end with _test/);
  });
  it('e2e-r46/public/serve-lab.mjs', () => {
    expect(run('e2e-r46/public/serve-lab.mjs', { R46_PORT: '3000' }).stderr).toMatch(/owner LAB/);
    expect(run('e2e-r46/public/serve-lab.mjs', { R46_PORT: '5191', DATABASE_URL: 'postgres://u@127.0.0.1:5432/ada_x_test' }).stderr).toMatch(/port 55434/);
  });
  it('e2e-r46/finish/run-lab.mjs', () => {
    expect(run('e2e-r46/finish/run-lab.mjs', { R46F_PORT: '5191', R46F_PORT_CONF: '3000', DATABASE_URL: TEST_DB }).stderr).toMatch(/owner LAB/);
    expect(run('e2e-r46/finish/run-lab.mjs', { R46F_PORT: '5191', R46F_PORT_CONF: '5192', DATABASE_URL: 'postgres://u@127.0.0.1:55434/ada_lab' }).stderr).toMatch(/must end with _test/);
  });
  it('scripts/lab-server.mjs: refused in a test context on :3000 or a non-test database; the owner LAB (no test flag) is not affected by this guard', () => {
    const lab = run('scripts/lab-server.mjs', { ADA_TEST_ISOLATION: '1', LAB_PORT: '3000', DATABASE_URL: TEST_DB, LAB_DIST: '/nonexistent' });
    expect(lab.status).toBe(3); expect(lab.stderr).toMatch(/refusing to start: test context: port 3000 is the owner LAB/);
    const db = run('scripts/lab-server.mjs', { NODE_ENV: 'test', LAB_PORT: '5191', DATABASE_URL: 'postgres://u@127.0.0.1:5432/ada_lab', LAB_DIST: '/nonexistent' });
    expect(db.status).toBe(3); expect(db.stderr).toMatch(/refusing to start: test context: the test database is on port 55434/);
    // without a test flag the next check is the pre-existing one (no build in LAB_DIST): the isolation guard did not interfere
    const owner = run('scripts/lab-server.mjs', { NODE_ENV: 'development', LAB_PORT: '3000', DATABASE_URL: 'postgres://u@127.0.0.1:5432/ada_lab', LAB_DIST: '/nonexistent' });
    expect(owner.status).toBe(3); expect(owner.stderr).toMatch(/refusing to start: no build in/);
    // e2e-r46/finish/run-lab.mjs marks its lab-server children as a test context
    expect(fs.readFileSync('e2e-r46/finish/run-lab.mjs', 'utf8')).toMatch(/ADA_TEST_ISOLATION: '1'/);
  });
});
