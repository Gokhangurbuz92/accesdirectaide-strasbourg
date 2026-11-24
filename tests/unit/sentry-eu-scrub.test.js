/**
 * R5-S1 — browser error tracking (Sentry, EU region, errors only): synthetic events and breadcrumbs go through the real scrubber and nothing personal
 * remains; the SDK is initialised without tracing / replay / release-health session, only in a Vercel Production build with an EU DSN; the CSP allows
 * exactly the EU ingest wildcard.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SENTRY_DENY_URLS, keptDefaultIntegrations, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from '../../src/observability/sentryScrub.js';
import { errorTrackingActive } from '../../src/config/env.js';

const TOKEN = ['fixture', 'share', 'token', 'synthetic'].join('-');   // 30 chars, obviously synthetic (no secret-scanner noise)            // 24 chars: a share / reset token
const EMAIL = 'marie.dupont@example.org';
const IP = '203.0.113.42';
const SECRET_INPUT = 'Mon numéro 1 85 05 75 123 456 78';
const EU_DSN = 'https://abc123@o4510000000000000.ingest.de.sentry.io/4510000000000001';
const US_DSN = 'https://abc123@o4510000000000000.ingest.us.sentry.io/4510000000000001';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@sentry/react'); });

describe('scrubUrl', () => {
  it('drops query strings and fragments everywhere', () => {
    expect(scrubUrl('https://accesdirectaide.fr/aides?q=rsa&email=a@b.fr#x')).toBe('https://accesdirectaide.fr/aides');
    expect(scrubUrl('/reset-password?token=abc')).toBe('/reset-password');
    expect(scrubUrl('/aides#section')).toBe('/aides');
  });
  it('masks the dynamic parts of personal paths and any token-like segment', () => {
    expect(scrubUrl(`https://accesdirectaide.fr/share/${TOKEN}`)).toBe('https://accesdirectaide.fr/share/[id]');
    expect(scrubUrl('/share/abc')).toBe('/share/[id]');
    expect(scrubUrl('/passport/p1/view')).toBe('/passport/[id]/[id]');
    expect(scrubUrl(`/reset-password/${TOKEN}`)).toBe('/reset-password/[id]');
    expect(scrubUrl('/rdv/42/annuler')).toBe('/rdv/[id]/[id]');
    expect(scrubUrl('/compte/partages/7f3a')).toBe('/compte/partages/[id]');
    expect(scrubUrl(`/api/whatever/${TOKEN}/x`)).toBe('/api/whatever/[id]/x');
    expect(scrubUrl('/aides/allocation-logement')).toBe('/aides/allocation-logement');   // a short public slug stays (19 chars)
    expect(scrubUrl('/compte/messages')).toBe('/compte/messages');
  });
  it('non-strings are returned untouched', () => { expect(scrubUrl(undefined)).toBeUndefined(); });
});

describe('scrubText', () => {
  it('removes e-mails, URL parameters and path tokens inside an error message', () => {
    const out = String(scrubText(`Failed to fetch https://accesdirectaide.fr/api/share/${TOKEN}?email=${EMAIL} for ${EMAIL} at /rdv/99?x=1`));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain('?');
    expect(out).toContain('[email]');
    expect(out).toContain('/rdv/[id]');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops ui.input and console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'ui.input', message: SECRET_INPUT })).toBeNull();
    expect(scrubBreadcrumb({ category: 'console', message: EMAIL, data: { arguments: [EMAIL] } })).toBeNull();
  });
  it('fetch / xhr keep method, scrubbed URL and status only', () => {
    for (const category of ['fetch', 'xhr']) {
      const b = scrubBreadcrumb({ category, type: 'http', data: { method: 'POST', url: `/api/share/${TOKEN}?email=${EMAIL}`, status_code: 404, request_body: SECRET_INPUT, response_body_size: 9 } });
      expect(b.data).toEqual({ method: 'POST', url: '/api/share/[id]', status_code: 404 });
      expect(JSON.stringify(b)).not.toMatch(new RegExp(`${TOKEN}|${EMAIL}|1 85 05`));
    }
  });
  it('navigation from / to are scrubbed', () => {
    const b = scrubBreadcrumb({ category: 'navigation', data: { from: `/reset-password?token=${TOKEN}`, to: '/passport/abc?k=1' } });
    expect(b.data).toEqual({ from: '/reset-password', to: '/passport/[id]' });
  });
});

describe('scrubEvent', () => {
  const event = () => ({
    message: `Erreur pour ${EMAIL}`,
    user: { id: 'u1', email: EMAIL, ip_address: IP, username: 'marie' },
    extra: { form: SECRET_INPUT },
    request: { url: `https://accesdirectaide.fr/share/${TOKEN}?email=${EMAIL}#frag`, query_string: `email=${EMAIL}`, cookies: { ada_user_session: 'S' },
      data: { password: 'x' }, headers: { 'User-Agent': 'Mozilla/5.0 Firefox/130', Referer: `https://accesdirectaide.fr/rdv/5?t=${TOKEN}`, Cookie: 'ada_user_session=S', Authorization: 'Bearer T' } },
    contexts: { runtime: { name: 'browser', env: { SECRET: 'x' } }, state: { form: SECRET_INPUT } },
    tags: { url: `/compte/partages/${TOKEN}?a=b` },
    transaction: `/share/${TOKEN}`,
    exception: { values: [{ type: 'TypeError', value: `Cannot read ${EMAIL} at https://accesdirectaide.fr/rdv/12?x=${TOKEN}`,
      stacktrace: { frames: [{ filename: 'https://accesdirectaide.fr/assets/index-abc.js?v=1', abs_path: 'https://accesdirectaide.fr/assets/index-abc.js?v=1', vars: { email: EMAIL } }] } }] },
    breadcrumbs: [
      { category: 'ui.input', message: SECRET_INPUT },
      { category: 'console', message: EMAIL },
      { category: 'fetch', data: { method: 'GET', url: `/api/passport/${TOKEN}?email=${EMAIL}`, status_code: 200 } },
      { category: 'navigation', data: { from: '/', to: `/share/${TOKEN}` } },
      { category: 'ui.click', message: 'button.submit' },
    ],
  });

  it('nothing personal remains anywhere in the event', () => {
    const out = scrubEvent(event());
    const json = JSON.stringify(out);
    for (const bad of [TOKEN, EMAIL, IP, '1 85 05', 'marie', 'Bearer', 'ada_user_session', 'SECRET', 'Referer', 'password', '?', '#frag']) expect(json, bad).not.toContain(bad);
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.request).toEqual({ url: 'https://accesdirectaide.fr/share/[id]', headers: { 'User-Agent': 'Mozilla/5.0 Firefox/130' } });
    expect(out.breadcrumbs.map((b) => b.category)).toEqual(['fetch', 'navigation', 'ui.click']);
    expect(out.exception.values[0].stacktrace.frames[0]).toEqual({ filename: 'https://accesdirectaide.fr/assets/index-abc.js', abs_path: 'https://accesdirectaide.fr/assets/index-abc.js' });
    expect(out.transaction).toBe('/share/[id]');
    expect(out.tags.url).toBe('/compte/partages/[id]');
  });
  it('an event without request or breadcrumbs passes', () => {
    expect(scrubEvent({ exception: { values: [{ type: 'Error', value: 'boom' }] } })).toEqual({ exception: { values: [{ type: 'Error', value: 'boom' }] } });
  });
});

describe('SDK options', () => {
  it('browser extensions are denied; the release-health session integration is dropped', () => {
    expect(SENTRY_DENY_URLS.some((r) => r.test('chrome-extension://abc/x.js'))).toBe(true);
    expect(SENTRY_DENY_URLS.some((r) => r.test('moz-extension://abc/x.js'))).toBe(true);
    expect(SENTRY_DENY_URLS.some((r) => r.test('https://accesdirectaide.fr/assets/x.js'))).toBe(false);
    expect(keptDefaultIntegrations([{ name: 'Breadcrumbs' }, { name: 'BrowserSession' }, { name: 'HttpContext' }]).map((i) => i.name)).toEqual(['Breadcrumbs', 'HttpContext']);
  });

  it('errorTrackingActive: EU DSN + production build + Vercel Production only', () => {
    expect(errorTrackingActive({ dsn: EU_DSN, deployEnv: 'production', vercelProduction: true })).toBe(true);
    expect(errorTrackingActive({ dsn: undefined, deployEnv: 'production', vercelProduction: true })).toBe(false);
    expect(errorTrackingActive({ dsn: EU_DSN, deployEnv: 'production', vercelProduction: false })).toBe(false);   // a Vercel Preview build
    expect(errorTrackingActive({ dsn: EU_DSN, deployEnv: 'development', vercelProduction: true })).toBe(false);
    expect(errorTrackingActive({ dsn: US_DSN, deployEnv: 'production', vercelProduction: true })).toBe(false);   // not the EU region
    expect(errorTrackingActive({ dsn: 'not a url', deployEnv: 'production', vercelProduction: true })).toBe(false);
  });

  it('errorTrackingActive reads the build (VITE_SENTRY_DSN, VITE_DEPLOY_ENV, VERCEL_ENV)', () => {
    vi.stubEnv('VITE_SENTRY_DSN', EU_DSN); vi.stubEnv('VITE_DEPLOY_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'production');
    expect(errorTrackingActive()).toBe(true);
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(errorTrackingActive()).toBe(false);
  });

  it('initSentry: errors only — no tracing, no trace headers, no replay, sendDefaultPii false, scrubbers wired', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', EU_DSN); vi.stubEnv('VITE_DEPLOY_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'production');
    const init = vi.fn();
    const replayIntegration = vi.fn(); const browserTracingIntegration = vi.fn();
    vi.doMock('@sentry/react', () => ({ init, replayIntegration, browserTracingIntegration }));
    const { initSentry } = await import('../../src/observability/initSentry.js');
    await initSentry();
    expect(init).toHaveBeenCalledTimes(1);
    const o = init.mock.calls[0][0];
    expect(o.dsn).toBe(EU_DSN);
    expect(o.sendDefaultPii).toBe(false);
    expect('tracesSampleRate' in o).toBe(false);
    expect(o.tracePropagationTargets).toEqual([]);
    expect(o.replaysSessionSampleRate).toBe(0);
    expect(o.replaysOnErrorSampleRate).toBe(0);
    expect(replayIntegration).not.toHaveBeenCalled();
    expect(browserTracingIntegration).not.toHaveBeenCalled();
    expect(o.integrations([{ name: 'BrowserSession' }, { name: 'GlobalHandlers' }]).map((i) => i.name)).toEqual(['GlobalHandlers']);
    expect(o.denyUrls.map(String)).toEqual(SENTRY_DENY_URLS.map(String));
    expect(o.beforeBreadcrumb({ category: 'ui.input', message: SECRET_INPUT })).toBeNull();
    expect(JSON.stringify(o.beforeSend({ user: { email: EMAIL }, request: { url: `/share/${TOKEN}?e=${EMAIL}` } }))).not.toMatch(new RegExp(`${TOKEN}|${EMAIL}`));
  });

  it('vite.config.js maps the Production SENTRY_DSN into the client VITE_SENTRY_DSN (VITE_SENTRY_DSN first), never undefined', async () => {
    const { sentryDsnDefine } = await import('../../vite.config.js');
    expect(sentryDsnDefine({ SENTRY_DSN: EU_DSN })).toBe(JSON.stringify(EU_DSN));
    expect(sentryDsnDefine({ VITE_SENTRY_DSN: EU_DSN, SENTRY_DSN: US_DSN })).toBe(JSON.stringify(EU_DSN));
    expect(sentryDsnDefine({})).toBe('""');
    expect(readFileSync('vite.config.js', 'utf8')).toMatch(/"import\.meta\.env\.VITE_SENTRY_DSN": sentryDsnDefine\(\),/);
    // the empty string means « no DSN » for the flag
    expect(errorTrackingActive({ dsn: '', deployEnv: 'production', vercelProduction: true })).toBe(false);
  });

  it('initSentry does nothing in a Preview build, even with a DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', EU_DSN); vi.stubEnv('VITE_DEPLOY_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview');
    const init = vi.fn();
    vi.doMock('@sentry/react', () => ({ init }));
    const { initSentry } = await import('../../src/observability/initSentry.js');
    await initSentry();
    expect(init).not.toHaveBeenCalled();
  });

  it('the source no longer contains browser tracing', () => {
    const src = readFileSync('src/observability/initSentry.js', 'utf8');
    expect(src).not.toMatch(/browserTracingIntegration\(/);
    expect(src).not.toMatch(/tracesSampleRate:/);
  });
});

describe('CSP: the EU ingest wildcard, exactly', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
  const connectOf = (v) => v.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src')).split(/\s+/).slice(1);
  it('enforced and Report-Only policies: self, the HDS service and https://*.ingest.de.sentry.io — no other Sentry host', () => {
    for (const key of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
      const c = connectOf(headers.find((h) => h.key === key).value);
      expect(c, key).toEqual(["'self'", 'https://ada-hds-strasbourg.osc-fr1.scalingo.io', 'https://*.ingest.de.sentry.io']);
      expect(c.filter((x) => /sentry/.test(x)), key).toEqual(['https://*.ingest.de.sentry.io']);
    }
  });
  it('the record pages served by the API function carry the same connect-src', () => {
    expect(readFileSync('api/_services/page-head.js', 'utf8')).toContain("connect-src 'self' https://ada-hds-strasbourg.osc-fr1.scalingo.io https://*.ingest.de.sentry.io;");
  });
});
