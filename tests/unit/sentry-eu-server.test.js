/**
 * R5-S1 — server error tracking (api/_utils/sentryServer.js): the same scrubbing as the browser (src/observability/sentryScrub.js), no tracing by
 * default, and nothing sent outside a Vercel Production deployment with an EU DSN. Synthetic events only; no real DSN.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const EU_DSN = 'https://abc123@o4510000000000000.ingest.de.sentry.io/4510000000000001';
const US_DSN = 'https://abc123@o4510000000000000.ingest.us.sentry.io/4510000000000001';
const TOKEN = 'k9Xr2_Qm7-ZpL4vT8wYb3NcD';
const EMAIL = 'marie.dupont@example.org';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@sentry/node'); });

async function loadWith(envs) {
  vi.resetModules();
  if (envs.VERCEL_ENV === 'production') vi.stubEnv('DATABASE_URL', 'postgres://test@127.0.0.1:1/test');   // env.js validates Production
  for (const [k, v] of Object.entries(envs)) vi.stubEnv(k, v);
  const init = vi.fn();
  vi.doMock('@sentry/node', () => ({ init, default: {} }));
  const mod = await import('../../api/_utils/sentryServer.js');
  return { mod, init };
}

describe('server scrubber', () => {
  it('x-forwarded-for, x-real-ip, cf-connecting-ip, authorization, cookie and every other header go; only the user-agent stays', async () => {
    const { mod } = await loadWith({});
    const out = mod.sanitizeSentryEvent({
      user: { id: 'u1', email: EMAIL, ip_address: '203.0.113.9' },
      request: { url: `https://accesdirectaide.fr/api/share/${TOKEN}?email=${EMAIL}`, method: 'POST', query_string: `email=${EMAIL}`, cookies: { ada_user_session: 'S' },
        data: { note: 'situation familiale' }, env: { REMOTE_ADDR: '203.0.113.9' },
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-real-ip': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9', authorization: 'Bearer T',
          cookie: 'ada_user_session=S', referer: `https://accesdirectaide.fr/rdv/5?t=${TOKEN}`, 'user-agent': 'node-test/1.0' } },
      tags: { route: `share/${TOKEN}`, requestId: 'req_1' },
      contexts: { http: { method: 'POST', path: `/rdv/42?x=${TOKEN}` }, runtime: { name: 'node', env: { SECRET: 'x' } } },
      extra: { requestId: 'req_1', note: `contact ${EMAIL}` },
      exception: { values: [{ type: 'Error', value: `failed for ${EMAIL}`, stacktrace: { frames: [{ filename: 'api/index.js', lineno: 3, vars: { email: EMAIL } }] } }] },
      breadcrumbs: [
        { category: 'console', message: `log ${EMAIL}` },
        { category: 'http', data: { method: 'GET', url: `https://api.example/passport/${TOKEN}?k=1`, status_code: 200 } },
        { category: 'http', data: { method: 'POST', url: '/x', request_body: 'secret body' } },
      ],
    });
    const json = JSON.stringify(out);
    for (const bad of ['203.0.113.9', '10.0.0.1', 'Bearer', 'ada_user_session', TOKEN, EMAIL, 'situation', 'secret body', 'REMOTE_ADDR', 'SECRET', 'referer', '?']) expect(json, bad).not.toContain(bad);
    expect(out.user).toBeUndefined();
    expect(out.request).toEqual({ url: 'https://accesdirectaide.fr/api/share/[id]', headers: { 'user-agent': 'node-test/1.0' } });
    expect(out.tags).toMatchObject({ route: 'share/[id]', requestId: 'req_1' });
    expect(out.contexts.http.path).toBe('/rdv/[id]');
    expect(out.extra.requestId).toBe('req_1');   // PKG-6 / D21 safe diagnostics stay
    expect(out.exception.values[0].value).toBe('[message removed: may contain request data]');
    expect(out.breadcrumbs).toEqual([{ category: 'http', data: { method: 'GET', url: 'https://api.example/passport/[id]', status_code: 200 } }]);
  });

  it('breadcrumbs: console dropped, a body dropped, http URL scrubbed', async () => {
    const { mod } = await loadWith({});
    expect(mod.sanitizeSentryBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
    expect(mod.sanitizeSentryBreadcrumb({ category: 'http', data: { url: '/a', body: 'b' } })).toBeNull();
    expect(mod.sanitizeSentryBreadcrumb({ category: 'http', data: { method: 'GET', url: `/reset-password/${TOKEN}?a=1`, status_code: 404 } }).data)
      .toEqual({ method: 'GET', url: '/reset-password/[id]', status_code: 404 });
  });
});

describe('server tracing and activation', () => {
  it('tracing stays off by default; SENTRY_TRACES_SAMPLE_RATE alone does nothing', async () => {
    const { mod } = await loadWith({});
    expect(mod.tracesSampleRate(undefined, undefined)).toBeUndefined();
    expect(mod.tracesSampleRate('0.1', '')).toBeUndefined();
    expect(mod.tracesSampleRate('0.1', 'on')).toBe(0.1);
  });

  it('serverSentryActive: Vercel Production AND EU DSN only', async () => {
    const { mod } = await loadWith({});
    expect(mod.serverSentryActive({ dsn: EU_DSN, environment: 'production' })).toBe(true);
    expect(mod.serverSentryActive({ dsn: EU_DSN, environment: 'preview' })).toBe(false);
    expect(mod.serverSentryActive({ dsn: US_DSN, environment: 'production' })).toBe(false);
    expect(mod.serverSentryActive({ dsn: '', environment: 'production' })).toBe(false);
  });

  it('Production + EU DSN: init without tracesSampleRate, sendDefaultPii false, scrubbers wired', async () => {
    const { init, mod } = await loadWith({ SENTRY_DSN: EU_DSN, VERCEL_ENV: 'production', SENTRY_TRACES_SAMPLE_RATE: '0.5' });
    expect(init).toHaveBeenCalledTimes(1);
    const o = init.mock.calls[0][0];
    expect(o.sendDefaultPii).toBe(false);
    expect('tracesSampleRate' in o).toBe(false);   // a rate without SENTRY_SERVER_TRACING=on is ignored
    expect(o.beforeSend).toBe(mod.sanitizeSentryEvent);
    expect(o.beforeBreadcrumb).toBe(mod.sanitizeSentryBreadcrumb);
  });

  it('explicit opt-in: SENTRY_SERVER_TRACING=on and a rate', async () => {
    const { init } = await loadWith({ SENTRY_DSN: EU_DSN, VERCEL_ENV: 'production', SENTRY_TRACES_SAMPLE_RATE: '0.2', SENTRY_SERVER_TRACING: 'on' });
    expect(init.mock.calls[0][0].tracesSampleRate).toBe(0.2);
  });

  it('Preview or a non-EU DSN: no init at all', async () => {
    expect((await loadWith({ SENTRY_DSN: EU_DSN, VERCEL_ENV: 'preview' })).init).not.toHaveBeenCalled();
    expect((await loadWith({ SENTRY_DSN: US_DSN, VERCEL_ENV: 'production' })).init).not.toHaveBeenCalled();
  });
});
