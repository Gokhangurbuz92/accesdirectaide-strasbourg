/**
 * R34 — `npm run vercel:env:check` lists the variables the production gate reads (names only), instead of a missing `.env.template`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { gateVarNames } from '../../scripts/vercel-env-sync.mjs';

describe('vercel env check', () => {
  const names = gateVarNames(fs.readFileSync('scripts/release-preflight.mjs', 'utf8'));
  it('reads the names from the production gate, including the arrays of names it checks', () => {
    for (const n of ['DATABASE_URL', 'AUTH_SECRET', 'KV_REST_API_URL', 'ADA_LOCAL_STORAGE_DIR', 'STORAGE_ENDPOINT', 'STORAGE_SECRET_ACCESS_KEY', 'VITE_PUBLIC_DIAGNOSTICS']) expect(names).toContain(n);
    expect(names.every((n) => /^[A-Z0-9_]+$/.test(n))).toBe(true);
  });
  it('no longer depends on a .env.template and never prints a value', () => {
    const src = fs.readFileSync('scripts/vercel-env-sync.mjs', 'utf8');
    expect(src).not.toMatch(/\.env\.template'/);
    expect(src).not.toMatch(/\.value\b/);
  });
});
