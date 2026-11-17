/**
 * A-11 — dead public components removed after a search of imports, routes and tests: src/components/layout/Header.jsx (hardcoded French; the mounted
 * header is in src/pages/Layout.jsx), src/components/assistant/ResultPanel.jsx and RecommendationCard.jsx (legacy assistant panel, imported by nothing).
 * They stay removed, and nothing refers to them. (api/_handlers/public/assistant/orient.js and api/_handlers/drees.js are NOT dead: they are routed,
 * covered by tests and by the activation harness, and documented in the API reference.)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const REMOVED = ['src/components/layout/Header.jsx', 'src/components/assistant/ResultPanel.jsx', 'src/components/assistant/RecommendationCard.jsx'];
const walk = (/** @type {string} */ dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(join(dir, e.name))) : /\.(jsx?|tsx?)$/.test(e.name) ? [join(dir, e.name)] : []));

describe('A-11: dead public components stay removed', () => {
  it.each(REMOVED)('%s no longer exists', (f) => { expect(existsSync(join(root, f))).toBe(false); });
  it('no source file imports them', () => {
    const importers = walk(join(root, 'src')).filter((f) => /from\s+['"][^'"]*(?:layout\/Header|\/ResultPanel|\/RecommendationCard|\.\/Header)['"]/.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual([]);
  });
  it('the hardcoded-text exception list no longer carries entries for removed files', () => {
    const list = readFileSync(join(root, 'scripts/i18n-hardcoded-exceptions.json'), 'utf8');
    for (const f of REMOVED) expect(list).not.toContain(f);
  });
  it('the two routed handlers the audit listed are kept: both are routed and have consumers', () => {
    const routes = readFileSync(join(root, 'api/routes.js'), 'utf8');
    expect(routes).toMatch(/public\/assistant\/orient/); expect(routes).toMatch(/drees/);
    expect(existsSync(join(root, 'api/_handlers/public/assistant/orient.js'))).toBe(true);
    expect(existsSync(join(root, 'api/_handlers/drees.js'))).toBe(true);
  });
});
