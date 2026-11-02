/**
 * R37 — a public guide lives at /bonnes-pratiques/:slug. The search page linked guides to /guides/:slug, a route that does not exist (the visitor got the
 * 404 page), and the accessibility audit checked that 404 page instead of the guides.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f) ? [p] : []; });

describe('public guide links', () => {
  it('no public page links to /guides/… (only the admin area has a guides route)', () => {
    const bad = files('src').filter((p) => /to=\{?[`'"]\/guides\//.test(readFileSync(p, 'utf8')));
    expect(bad).toEqual([]);
    expect(readFileSync('src/pages/Recherche.jsx', 'utf8')).toMatch(/to=\{`\/bonnes-pratiques\/\$\{g\.slug\}`\}/);
  });
  it('the accessibility audit opens the real guide pages', () => {
    const a11y = readFileSync('scripts/acceptance/r33-a11y.mjs', 'utf8');
    expect(a11y).toMatch(/\/bonnes-pratiques\/duree-de-conservation-des-papiers-f19134/);
    expect(a11y).not.toMatch(/,\/guides[,/]/);
  });
});
