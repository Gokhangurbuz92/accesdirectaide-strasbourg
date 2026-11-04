/**
 * R42-POLISH (R41 review F8) — staged, privacy-preserving CSP violation reporting (api/_utils/csp-reporting.js, api/_handlers/monitor/csp-report.js):
 *   - LAB (VERCEL_ENV development/preview) accepts reports; Production and unknown environments refuse them unless ADA_CSP_REPORTS=log; « off » wins;
 *   - only POST to the exact report path passes the beta gate (edge middleware and api/index.js allowlist); no other monitor route, no job;
 *   - the log line carries no query string, fragment, id, token, e-mail, sample, referrer, source file, address or cookie;
 *   - rate limit unavailable = nothing logged; sampling; the same summary at most once per 10 minutes per instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rate = vi.fn();
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: (...a) => rate(...a) }));
const warn = vi.fn();
vi.mock('../../api/_utils/logger.js', () => ({ default: { warn: (...a) => warn(...a), info: vi.fn(), error: vi.fn() } }));

const { cspReportsMode, isCspReportRequest, pageTemplate, cspSampleRate } = await import('../../api/_utils/csp-reporting.js');
const { isAllowedInPublicBeta } = await import('../../api/_utils/public-beta.js');
const csp = await import('../../api/_handlers/monitor/csp-report.js');

const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
const mk = () => ({ statusCode: 0, headers: {}, cookies: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json() { return this; }, end() { return this; } });
const report = (documentURL, extra = {}) => [{ type: 'csp-violation', body: { documentURL, effectiveDirective: 'img-src', blockedURL: 'https://tracker.example.test/p.gif?uid=PLANTED', sample: 'PLANTED', referrer: 'https://www.example.test/?t=PLANTED', sourceFile: 'https://www.example.test/x.js?k=PLANTED', ...extra } }];

beforeEach(() => { rate.mockReset(); rate.mockResolvedValue({ allowed: true }); warn.mockClear(); csp.resetCspReportState(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('mode: on in LAB, fail-closed in Production', () => {
  it.each([
    [{}, 'off'], [{ VERCEL_ENV: 'production' }, 'off'], [{ VERCEL_ENV: 'production', ADA_CSP_REPORTS: 'yes' }, 'off'], [{ NODE_ENV: 'development' }, 'off'],
    [{ VERCEL_ENV: 'production', ADA_CSP_REPORTS: 'log' }, 'log'], [{ VERCEL_ENV: 'development' }, 'log'], [{ VERCEL_ENV: 'preview' }, 'log'],
    [{ VERCEL_ENV: 'development', ADA_CSP_REPORTS: 'off' }, 'off'], [{ VERCEL_ENV: 'production', ADA_CSP_REPORTS: ' LOG ' }, 'log'],
  ])('%j → %s', (env, mode) => { expect(cspReportsMode(env)).toBe(mode); });
  it('sampling rate: (0, 1], anything else is 1', () => {
    expect(cspSampleRate({ ADA_CSP_REPORT_SAMPLE: '0.1' })).toBe(0.1);
    for (const v of [undefined, '0', '-1', '2', 'x']) expect(cspSampleRate({ ADA_CSP_REPORT_SAMPLE: v })).toBe(1);
  });
});

describe('beta gate', () => {
  it('Production during the beta: refused unless explicitly enabled; only POST to the exact path when enabled', () => {
    expect(isAllowedInPublicBeta('POST', 'monitor/csp-report', { ...BETA, VERCEL_ENV: 'production' })).toBe(false);
    const on = { ...BETA, VERCEL_ENV: 'production', ADA_CSP_REPORTS: 'log' };
    expect(isAllowedInPublicBeta('POST', 'monitor/csp-report', on)).toBe(true);
    for (const [m, p] of [['GET', 'monitor/csp-report'], ['PUT', 'monitor/csp-report'], ['POST', 'monitor/core'], ['POST', 'monitor/csp-report/x'], ['POST', 'monitor'], ['POST', 'cron/veille']])
      expect(isAllowedInPublicBeta(m, p, on), `${m} ${p}`).toBe(false);
  });
  it('LAB during the beta: accepted by default, refused with ADA_CSP_REPORTS=off', () => {
    expect(isAllowedInPublicBeta('POST', 'monitor/csp-report', { ...BETA, VERCEL_ENV: 'development' })).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'monitor/csp-report', { ...BETA, VERCEL_ENV: 'development', ADA_CSP_REPORTS: 'off' })).toBe(false);
    expect(isCspReportRequest('POST', 'monitor/csp-report', { VERCEL_ENV: 'preview' })).toBe(true);
  });
  it('edge middleware: lets the report through only when reporting is on; other monitor routes stay 503', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ADA_CSP_REPORTS', '');
    const { directFunctionResponse } = await import('../../middleware.js');
    const u = (p) => new URL(`https://www.accesdirectaide.fr${p}`);
    expect(directFunctionResponse(u('/api/monitor/csp-report'), 'POST')?.status).toBe(503);
    vi.stubEnv('ADA_CSP_REPORTS', 'log');
    expect(directFunctionResponse(u('/api/monitor/csp-report'), 'POST')).toBeNull();
    expect(directFunctionResponse(u('/api/monitor/csp-report'), 'GET')?.status).toBe(503);
    expect(directFunctionResponse(u('/api/monitor/core'), 'POST')?.status).toBe(503);
    expect(directFunctionResponse(u('/api/cron/veille'), 'POST')?.status).toBe(503);
  });
});

describe('page path template', () => {
  it.each([
    ['https://www.example.test/aides?q=PLANTED#frag', '/aides'],
    ['https://www.example.test/espace/dossier', '/espace/dossier'],
    ['https://www.example.test/rdv/gestion/3f2a9c1e-1d2b-4c5d-8e9f-0a1b2c3d4e5f', '/rdv/gestion/:id'],
    ['https://www.example.test/partage/AbCdEf0123456789xyzTOKEN', '/partage/:id'],
    ['https://www.example.test/aides/fonds-solidarite-f188c3', '/aides/:id'],
    ['https://www.example.test/compte/prenom.nom%40example.test', '/compte/:id'],
    ['https://www.example.test/x/abcdefghijklmnopqrstuvwxyzabcd', '/x/:id'],
    ['https://www.example.test/a/b/c/d/e/f', '/a/b/c/d/…'],
    ['https://www.example.test/%E0%A4%A', '/:id'],
    ['not a url', ''],
  ])('%s → %s', (u, t) => { expect(pageTemplate(u)).toBe(t); });
});

describe('handler', () => {
  const post = (body, headers = {}) => { const r = mk(); return csp.default({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9', cookie: 'ada_session=PLANTED', authorization: 'Bearer PLANTED', ...headers }, body }, r).then(() => r); };

  it('Production without the switch: 204, nothing logged, the limiter is not even asked', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const r = await post(report('https://www.example.test/aides'));
    expect(r.statusCode).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });

  it('LAB: one minimised line — no query, id, token, sample, referrer, source file, address, cookie or header; no cookie set', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    const r = await post(report('https://www.example.test/rdv/gestion/3f2a9c1e-1d2b-4c5d-8e9f-0a1b2c3d4e5f?token=PLANTED#PLANTED'));
    expect(r.statusCode).toBe(204);
    expect(r.headers['Set-Cookie']).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ msg: 'csp.violation', directive: 'img-src', blocked: 'https://tracker.example.test', page: '/rdv/gestion/:id', disposition: 'enforce' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PLANTED|203\.0\.113|3f2a9c1e|ada_session|Bearer/);
  });

  it('the rate limiter refusing or failing means nothing is logged', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    rate.mockResolvedValueOnce({ allowed: false });
    await post(report('https://www.example.test/aides'));
    rate.mockRejectedValueOnce(new Error('kv down'));
    await post(report('https://www.example.test/aides'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('the same summary is logged once per window, with the repeat count on the next line', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    const t0 = 1_800_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    for (let i = 0; i < 5; i += 1) await post(report(`https://www.example.test/rdv/gestion/id-${i}0000`));
    expect(warn).toHaveBeenCalledTimes(1);
    now.mockReturnValue(t0 + 11 * 60 * 1000);
    await post(report('https://www.example.test/rdv/gestion/x9'));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toMatchObject({ page: '/rdv/gestion/:id', repeatsSinceLast: 4 });
  });

  it('sampling: with ADA_CSP_REPORT_SAMPLE the report is dropped when the draw is above the rate', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('ADA_CSP_REPORT_SAMPLE', '0.1');
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await post(report('https://www.example.test/aides'));
    expect(warn).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });

  it('at most 60 lines per minute per instance', async () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    for (let i = 0; i < 70; i += 1) await post(report(`https://www.example.test/p${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`));
    expect(warn).toHaveBeenCalledTimes(60);
  });
});
