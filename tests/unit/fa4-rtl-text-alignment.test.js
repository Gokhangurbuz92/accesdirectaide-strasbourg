/**
 * FA-D4 (Arabic RTL) — text alignment follows the reading direction everywhere in src/: `text-start` / `text-end`, never `text-left` / `text-right`.
 * The RGAA audit (e2e-r47/rgaa) found the administration's data tables (shadcn TableHead, review queue, privacy console, health, observability) and the
 * institutional observatoire aligned to the left edge in Arabic. 56 physical alignment utilities in 21 files were replaced (identical in the five
 * left-to-right languages). Physical margins / paddings / offsets outside the citizen screens (A-22 guard) remain a documented residual.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PHYSICAL_ALIGN = /(?<=["'`\s:])text-(?:left|right)(?![\w-])/g;
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'locales' ? [] : files(p);
  return /\.(jsx?|tsx?)$/.test(e.name) && !/\.(test|stories)\./.test(e.name) ? [p] : [];
});

describe('FA-D4 logical text alignment in src/', () => {
  it('the detector sees physical alignment and accepts logical alignment', () => {
    expect('className="text-left sm:text-right"'.match(PHYSICAL_ALIGN)).toHaveLength(2);
    expect('className="text-start sm:text-end text-lefty"'.match(PHYSICAL_ALIGN)).toBeNull();
  });
  it('no text-left / text-right in any component or page', () => {
    const found = [];
    for (const f of files('src')) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { for (const m of line.match(PHYSICAL_ALIGN) || []) found.push(`${f}:${i + 1} ${m}`); });
    expect(found).toEqual([]);
  });
});
