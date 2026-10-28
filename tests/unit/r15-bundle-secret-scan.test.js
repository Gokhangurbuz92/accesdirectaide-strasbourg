/**
 * R15 — scripts/bundle-secret-scan.mjs: a server-only secret value found in the browser bundle fails the check; names only are reported; VITE_* values and
 * short values are not checked. Synthetic values in a temporary directory.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanBundle } from '../../scripts/bundle-secret-scan.mjs';

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
const bundle = (files) => { dir = mkdtempSync(join(tmpdir(), 'r15-bundle-')); mkdirSync(join(dir, 'assets')); for (const [p, t] of Object.entries(files)) writeFileSync(join(dir, p), t); return dir; };

describe('R15: no server secret in the browser bundle', () => {
  it('a leaked server secret is reported by name and file, the value never appears in the result', () => {
    const d = bundle({ 'assets/index-abc.js': 'const k="synthetic-session-secret-0123456789";', 'index.html': '<html></html>' });
    const r = scanBundle(d, { AUTH_SECRET: 'synthetic-session-secret-0123456789', CRON_SECRET: 'synthetic-cron-not-in-bundle-xyz' });
    expect(r.leaks).toEqual([{ name: 'AUTH_SECRET', file: join('assets', 'index-abc.js') }]);
    expect(JSON.stringify(r)).not.toContain('synthetic-session-secret');
    expect(r.checked).toEqual(['AUTH_SECRET', 'CRON_SECRET']);
  });

  it('VITE_* values (public by design), non-secret names and short values are not checked', () => {
    const d = bundle({ 'assets/a.js': 'https://public-dsn@o1.ingest.de.sentry.io/1 true 5432 https://app.example.test' });
    const r = scanBundle(d, { VITE_SENTRY_DSN: 'https://public-dsn@o1.ingest.de.sentry.io/1', APP_BASE_URL: 'https://app.example.test', DB_TOKEN_FLAG: 'true', DATABASE_URL: 'x' });
    expect(r.leaks).toEqual([]);
    expect(r.checked).toEqual([]);
  });
});
