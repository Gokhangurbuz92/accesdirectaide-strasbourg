/**
 * Q04 (loopback passive security baseline, 2026-10-28) — the regressions behind its three corrections:
 *  1. the public layout's accessibility modes come from a stylesheet, not an inline <style> element;
 *  2. a REPORT-ONLY policy measures the site without style-src 'unsafe-inline' (the enforced policy keeps it until the reports are clean): its only inline
 *     style allowance is the hash of the CSS that sonner injects, recomputed here from the installed package so an upgrade cannot silently break it;
 *  3. an undecodable detail segment (« %E0%A4%A ») is a 400, not the whole list publicly cached.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
const header = (k) => headers.find((h) => h.key === k)?.value || '';
const parse = (v) => Object.fromEntries(v.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [n, ...x] = d.split(/\s+/); return [n, x]; }));

describe('Q04 CSP: style-src without unsafe-inline (report-only)', () => {
  const enforced = parse(header('Content-Security-Policy')); const ro = parse(header('Content-Security-Policy-Report-Only'));
  it('the report-only policy is the enforced one with style-src tightened (and nothing else changed)', () => {
    expect(ro['style-src']).not.toContain("'unsafe-inline'");
    expect(ro['style-src'][0]).toBe("'self'");
    const { 'style-src': _a, 'upgrade-insecure-requests': _b, ...restE } = enforced; const { 'style-src': _c, ...restR } = ro;
    expect(restR).toEqual(restE);
    expect(ro['report-uri']).toEqual(['/api/monitor/csp-report']); expect(ro['report-to']).toEqual(['csp']);
  });
  it('its only inline-style hashes are the CSS the installed sonner injects (and the empty element it starts from)', () => {
    const dist = readFileSync('node_modules/sonner/dist/index.mjs', 'utf8');
    const m = dist.match(/__insertCSS\(("(?:[^"\\]|\\.)*")\)/); expect(m, 'sonner still injects its CSS through __insertCSS').toBeTruthy();
    const hash = `'sha256-${createHash('sha256').update(JSON.parse(m[1]), 'utf8').digest('base64')}'`;
    // sonner appends an EMPTY <style> first and fills it next: Chrome checks both states, so the empty content's hash is listed too (it allows no rule)
    const empty = `'sha256-${createHash('sha256').update('', 'utf8').digest('base64')}'`;
    expect(ro['style-src'].slice(1)).toEqual([hash, empty]);
  });
  it('the public layout has no inline <style> element; its accessibility modes are in a stylesheet it imports', () => {
    const layout = readFileSync('src/pages/Layout.jsx', 'utf8');
    expect(layout).not.toMatch(/<style[\s>]/);
    expect(layout).toContain("import '@/styles/layout-accessibility.css';");
    const css = readFileSync('src/styles/layout-accessibility.css', 'utf8');
    for (const sel of ['body.high-contrast', 'body.dark-mode', 'body.large-line-height', 'body.simplified-mode', '*:focus-visible']) expect(css).toContain(sel);
  });
});

vi.mock('../../src/db/index.js', () => ({ db: { query: {}, select: vi.fn() } }));
const mk = () => ({ statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

describe('Q04 malformed detail segment', () => {
  for (const name of ['aides', 'demarches', 'structures', 'actualites']) {
    it(`/api/${name}/%E0%A4%A is a 400 (no list, no database read)`, async () => {
      const { default: handler } = await import(`../../api/_handlers/${name}.js`);
      const res = mk();
      await handler({ method: 'GET', url: `/api/${name}/%E0%A4%A`, query: {}, headers: { host: '127.0.0.1' } }, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid parameters', details: { slug: 'malformed' } });
    });
  }
});
