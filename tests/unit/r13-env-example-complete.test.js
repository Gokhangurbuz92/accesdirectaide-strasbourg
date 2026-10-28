/**
 * R13 — every environment variable the runtime code reads (api/, src/, packages/, middleware.js, vite.config.js) is documented in .env.example, so a staging or
 * production configuration built from it misses nothing. The environment-variable audit of 27/10/2026 found 30+ undocumented ones (among them the Web Push
 * VAPID keys, the Outlook token key, the data·inclusion token and the veille guards). Names only: no value is read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['api', 'src', 'packages', 'middleware.js', 'vite.config.js'];
const READS = [/process\.env\.([A-Z][A-Z0-9_]+)/g, /process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g, /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  /\b(?:getEnv|getOptionalEnv|envAliases)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g, /\benv\.([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g];
// provided by the platform or the toolchain, never configured by the operator; BYPASS_SECRET is forbidden in production (documented as such, not as a setting)
const PLATFORM = new Set(['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_REGION', 'PORT', 'HOME', 'PATH', 'CI', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'BYPASS_SECRET']);
// object fields that look like names (notification outcome counters `e.NOT_DELIVERED`, …)
const NOT_ENV = new Set(['NOT_DELIVERED', 'OFF_BY_PREFERENCE', 'PROVIDER_ACCEPTED', 'TEST_RECORDED', 'FAILED']);

function files(p) {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p, { withFileTypes: true }).flatMap((d) => (d.name === 'node_modules' ? [] : files(path.join(p, d.name))));
}

describe('R13: .env.example documents every variable the runtime reads', () => {
  it('no runtime variable is missing from .env.example', () => {
    const documented = new Set([...fs.readFileSync('.env.example', 'utf8').matchAll(/^\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const read = new Map();
    for (const f of ROOTS.flatMap(files).filter((f) => /\.(m?js|jsx|ts|tsx)$/.test(f) && !/\.test\.|\.spec\.|\/__tests__\//.test(f))) {
      const t = fs.readFileSync(f, 'utf8');
      // a trailing _ is a dynamic prefix (import.meta.env[`VITE_${x}`]), not a variable
      for (const re of READS) for (const m of t.matchAll(re)) if (!PLATFORM.has(m[1]) && !NOT_ENV.has(m[1]) && !m[1].endsWith('_')) read.set(m[1], read.get(m[1]) || f);
    }
    expect(read.size).toBeGreaterThan(150);
    const missing = [...read].filter(([n]) => !documented.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });
});
