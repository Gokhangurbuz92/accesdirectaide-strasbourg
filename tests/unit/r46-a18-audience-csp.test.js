/**
 * R46 / A18 — the privacy-safe audience pipeline (ADR-022) is OFF by default and, when the owner switches it on, needs NO widening of the Content Security
 * Policy: with mode « production » and no DSN, both Vercel components load their script from the SAME origin (/_vercel/insights/script.js,
 * /_vercel/speed-insights/script.js) and report to the same origin (connect-src 'self'). The former ADR text asked to add va.vercel-scripts.com back to
 * script-src: that host serves only the debug scripts (development) or a DSN set-up (non-Vercel hosting), neither of which this product uses.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('A18: audience measurement activation keeps the CSP closed', () => {
  it('the installed components choose a same-origin script in production without a DSN', () => {
    const va = read('node_modules/@vercel/analytics/dist/react/index.mjs');
    const si = read('node_modules/@vercel/speed-insights/dist/react/index.mjs');
    expect(va).toMatch(/return "\/_vercel\/insights\/script\.js"/);
    expect(si).toMatch(/return "\/_vercel\/speed-insights\/script\.js"/);
    // the third-party host is reached only in development or with a DSN
    expect(va).toMatch(/if \(isDevelopment\(\)\) \{\s*return "https:\/\/va\.vercel-scripts\.com\/v1\/script\.debug\.js"/);
    expect(si).toMatch(/if \(props\.dsn\) \{\s*return "https:\/\/va\.vercel-scripts\.com\/v1\/speed-insights\/script\.js"/);
  });

  it('the app mounts both components in production mode, without a DSN, behind the OFF-by-default flag and the objection', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(/<Analytics mode=\{'production'\} beforeSend=\{dropIfObjected\} \/>/);
    expect(app).toMatch(/<SpeedInsights beforeSend=\{dropIfObjected\} \/>/);
    expect(app).not.toMatch(/dsn=/);
    expect(app).toMatch(/ANALYTICS_ENABLED && !hasObjectedToAudience\(\)/);
    expect(read('src/config/env.js')).toMatch(/audienceMeasurement: import\.meta\.env\.VITE_AUDIENCE_MEASUREMENT === 'on' && import\.meta\.env\.VITE_PUBLIC_BETA !== 'true'/);
  });

  it('the shipped CSP needs no change: script-src and connect-src stay self-only, the third-party host is not allowed', () => {
    const v = JSON.parse(read('vercel.json'));
    const csps = v.headers.flatMap((h) => h.headers).filter((h) => h.key === 'Content-Security-Policy').map((h) => h.value);
    expect(csps.length).toBeGreaterThan(0);
    for (const c of csps) {
      expect(c).toMatch(/script-src 'self'/);
      expect(c).toMatch(/connect-src 'self'/);
      expect(c).not.toContain('va.vercel-scripts.com');
    }
  });
});
