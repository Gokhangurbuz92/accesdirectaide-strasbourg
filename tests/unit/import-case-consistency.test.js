import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Guards Linux/CI portability: every `@/…` or relative import in src/ must match the exact case of the file on disk.
const ROOT = resolve(process.cwd(), 'src');
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.json', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]((?:@\/|\.{1,2}\/)[^'"]+)['"]/g;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? (name === 'node_modules' ? [] : walk(p)) : /\.(jsx?|tsx?)$/.test(name) ? [p] : [];
  });
}
function existsExactCase(absNoExt) {
  // TS convention: `./schema.js` may resolve to `./schema.ts(x)`.
  // Walk only the part below the project root (never list `/`, `/Users`, ...): works inside restricted sandboxes and is the same check.
  const REPO = resolve(ROOT, '..');
  const bases = /\.js$/.test(absNoExt) ? [absNoExt, absNoExt.replace(/\.js$/, '.ts'), absNoExt.replace(/\.js$/, '.tsx')] : [absNoExt];
  for (const full of bases.flatMap((b) => EXTS.map((ext) => b + ext))) {
    if (!full.startsWith(REPO + '/')) continue;
    const parts = full.slice(REPO.length + 1).split('/');
    let cur = REPO;
    let ok = true;
    for (const part of parts) {
      let entries;
      try { entries = readdirSync(cur); } catch { ok = false; break; }
      if (!entries.includes(part)) { ok = false; break; }
      cur = join(cur, part);
    }
    if (ok) return true;
  }
  return false;
}

describe('import path case consistency (src/)', () => {
  it('no import differs from the on-disk file name only by case', () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1];
        const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : resolve(dirname(file), spec);
        if (/\.(css|svg|png|jpe?g|woff2?|json)$/.test(spec)) continue;
        if (!existsExactCase(base)) offenders.push(`${file.replace(ROOT + '/', '')} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
