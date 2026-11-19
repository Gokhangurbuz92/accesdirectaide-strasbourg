/**
 * G4 (19/11/2026) — QA v56 mock e2e: /orientation crashed in the dev server (« Failed to fetch dynamically imported module ») because browser code
 * imported pure modules from api/lib/: the dev server proxies every /api/* URL to the API and never serves server source (vite.config.js
 * apiSourceGuardPlugin), so those imports cannot load in dev, while the production bundle hid the problem. Browser code must never import from api/;
 * shared pure modules live under src/lib/ (api/lib keeps re-export stubs).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(m?js|jsx|ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });

describe('browser code never imports server source', () => {
  it('no browser file under src/ imports a path inside api/ (src/db is server-only and excluded)', () => {
    const api = resolve('api');
    const bad = files('src').filter((f) => !f.startsWith(join('src', 'db'))).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
      .map((m) => resolve(dirname(f), m[1])).filter((t) => t === api || t.startsWith(api + '/')).map((t) => `${f} -> ${relative('.', t)}`));
    expect(bad).toEqual([]);
  });
});
