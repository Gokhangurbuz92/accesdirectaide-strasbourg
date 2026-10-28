/**
 * Launch-readiness item 54 — what the deployed function can read: the files read from disk at run time are part of the bundle (includeFiles was a comma-joined
 * glob, so its second half matched nothing, and no .json was included: the search synonyms, the OpenAPI document and the WS2 manifests were missing), the
 * project runs in the EU region, and the tests / the Docker-only server under api/ are never deployed as functions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import picomatch from 'picomatch';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const fn = vercel.functions['api/index.js'];
const included = picomatch(fn.includeFiles);

describe('Vercel runtime files', () => {
  it('every file the API reads from disk at run time is included', () => {
    for (const f of ['api/lib/synonyms.json', 'docs/openapi.json', 'data/strasbourg/ws2-source-manifest.json', 'data/strasbourg/ws2-review-queue.v2.json',
      'data/strasbourg/ws2-source-candidates.v1.json', 'data/news-sources.json', 'config/rss-sources.json', 'src/db/schema.ts', 'src/db/sealed-json.ts',
      'src/config/legal-documents.js', 'api/_handlers/health.js']) expect(included(f), f).toBe(true);
    expect(included('src/pages/Home.jsx')).toBe(false);
  });
  it('runs in the EU region (project and function)', () => {
    expect(vercel.regions).toEqual(['fra1']);
    expect(fn.regions).toEqual(['fra1']);
  });
  it('tests and the Docker-only server under api/ are not deployed', () => {
    const ignore = readFileSync('.vercelignore', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const ignored = picomatch(ignore.map((p) => (p.endsWith('/') ? `${p}**` : p)));
    for (const f of ['api/lib/crypto.test.ts', 'api/lib/gate2b3a-policy.test.js', 'api/tests/rbac.test.js', 'api/server.js']) expect(ignored(f), f).toBe(true);
    for (const f of ['api/index.js', 'api/lib/crypto.ts', 'api/_handlers/health.js']) expect(ignored(f), f).toBe(false);
  });
});
