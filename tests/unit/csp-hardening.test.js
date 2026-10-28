/**
 * Launch-readiness item 49 — the Content-Security-Policy names what the site really uses, reports violations without personal data, and no image is
 * fetched from a third party.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
const warn = vi.fn();
vi.mock('../../api/_utils/logger.js', () => ({ default: { warn: (...a) => warn(...a), info: vi.fn(), error: vi.fn() } }));

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
const header = (k) => headers.find((h) => h.key === k)?.value || '';
const csp = Object.fromEntries(header('Content-Security-Policy').split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [n, ...v] = d.split(/\s+/); return [n, v]; }));

describe('CSP (vercel.json)', () => {
  it('images: the site itself and the OpenStreetMap tiles only — no "https:" wildcard', () => {
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org']);
  });
  it('connections: no unused host, Sentry in the EU region only', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://*.ingest.de.sentry.io', 'https://*.vercel-analytics.com']);
    expect(csp['object-src']).toEqual(["'none'"]);
  });
  it('violations are reported to a route that exists', () => {
    expect(csp['report-uri']).toEqual(['/api/monitor/csp-report']);
    expect(csp['report-to']).toEqual(['csp']);
    expect(header('Reporting-Endpoints')).toBe('csp="/api/monitor/csp-report"');
    expect(readFileSync('api/routes.js', 'utf8')).toContain("path: 'monitor/csp-report'");
  });
  it('no component loads an image from a third-party placeholder service', () => {
    expect(readFileSync('src/components/ui/LazyImage.jsx', 'utf8')).not.toMatch(/https?:\/\//);
  });
});

describe('CSP report endpoint', () => {
  const mk = () => ({ statusCode: 0, headers: {}, ended: false, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json() { return this; }, end() { this.ended = true; return this; } });
  it('logs the directive, the blocked origin and the page path only — never a query string or a sample', async () => {
    const { default: handler } = await import('../../api/_handlers/monitor/csp-report.js');
    warn.mockClear();
    const legacy = { 'csp-report': { 'document-uri': 'https://www.example.test/espace/dossier?email=prenom.nom%40example.test', 'violated-directive': 'img-src',
      'effective-directive': 'img-src', 'blocked-uri': 'https://tracker.example.test/pixel.gif?uid=PLANTED-ID', 'script-sample': 'PLANTED-SAMPLE' } };
    const r = mk(); await handler({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify(legacy) }, r);
    expect(r.statusCode).toBe(204);
    expect(warn).toHaveBeenCalledWith({ msg: 'csp.violation', directive: 'img-src', blocked: 'https://tracker.example.test', page: '/espace/dossier', disposition: 'enforce' });
    const modern = [{ type: 'csp-violation', body: { documentURL: 'https://www.example.test/aides?q=PLANTED', effectiveDirective: 'script-src-elem', blockedURL: 'inline', sample: 'PLANTED-SAMPLE', disposition: 'report' } }];
    await handler({ method: 'POST', headers: {}, body: modern }, mk());
    expect(warn).toHaveBeenLastCalledWith({ msg: 'csp.violation', directive: 'script-src-elem', blocked: 'inline', page: '/aides', disposition: 'report' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PLANTED|prenom\.nom/);
  });
  it('ignores garbage and other methods', async () => {
    const { default: handler, summarizeCspReports } = await import('../../api/_handlers/monitor/csp-report.js');
    expect(summarizeCspReports('not json')).toEqual([]);
    expect(summarizeCspReports('x'.repeat(70000))).toEqual([]);
    const r = mk(); await handler({ method: 'GET', headers: {} }, r);
    expect(r.statusCode).toBe(405);
  });
});
