import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Static contract for the production HTTP security headers declared in vercel.json (the file Vercel enforces).
const root = process.cwd();
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
const headerList = vercel.headers.find((h) => h.source === '/(.*)').headers;
const header = (name) => headerList.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value || '';
const csp = Object.fromEntries(
  header('Content-Security-Policy').split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values];
  }),
);

describe('security headers (vercel.json)', () => {
  it('sets the baseline hardening headers', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Strict-Transport-Security')).toMatch(/max-age=(\d{8,})/);
    expect(header('Permissions-Policy')).toMatch(/geolocation=\(\)/);
  });

  it('CSP is default-deny with no script eval and no framing', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp).toHaveProperty('upgrade-insecure-requests');
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain('*');
    expect(csp['connect-src'].join(' ')).not.toMatch(/(^|\s)\*(\s|$)/);
  });

  it('every executable inline <script> in index.html is covered by a CSP sha256 hash', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => !/type\s*=\s*["']application\/(ld\+)?json["']/i.test(m[1]))
      .map((m) => m[2]);
    for (const body of inline) {
      const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
      expect(csp['script-src'], `inline script hash ${hash.slice(0, 20)}… missing from CSP`).toContain(hash);
    }
  });

  // KNOWN GAP (decision pending, see docs/release): in-app Visio loads https://meet.jit.si/external_api.js and a Jitsi iframe,
  // which script-src / frame-src (falls back to default-src 'self') and Permissions-Policy camera=(self) block in production.
  it.fails('KNOWN GAP: Visio third-party origin is allowed by CSP and Permissions-Policy', () => {
    expect(csp['script-src'].join(' ')).toContain('meet.jit.si');
    expect((csp['frame-src'] || csp['default-src']).join(' ')).toContain('meet.jit.si');
    expect(header('Permissions-Policy')).toMatch(/camera=\([^)]*meet\.jit\.si/);
  });
});
