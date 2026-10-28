/**
 * DTA S4A — static contract: every relation named in a `db.query.<Table>.findFirst|findMany({ with: { ... } })` of api/ and src/ must exist in src/db/schema.ts.
 * Why: `GET /api/structures?slug=` asked for `proServices` (not a relation; the relations are `proRdvServices`, `rdvSettings`). Drizzle throws in JS before any SQL, a catch-all answered 404,
 * and mocked handler tests never noticed (native S3B run 436e5e, DTA-B12).  Source-reading only: no database needed.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
  }
  return out;
};
const block = (s, i) => { let d = 0; for (let j = i; j < s.length; j += 1) { if (s[j] === '{') d += 1; else if (s[j] === '}') { d -= 1; if (d === 0) return s.slice(i, j + 1); } } return ''; };
const topKeys = (b) => { let depth = 0; const keys = []; for (const m of b.matchAll(/[{}]|(\w+):/g)) { if (m[0] === '{') depth += 1; else if (m[0] === '}') depth -= 1; else if (depth === 1) keys.push(m[1]); } return keys; };

const schema = fs.readFileSync(path.join(ROOT, 'src/db/schema.ts'), 'utf8');
const RELS = {};
for (const m of schema.matchAll(/export const (\w+)Relations = relations\((\w+), \(\{[^}]*\}\) => \(\{([\s\S]*?)\n\}\)\);/g)) {
  RELS[m[2]] = new Set([...m[3].matchAll(/^\s{1,2}(\w+): (?:one|many)\(/gm)].map((x) => x[1]));
}

describe('Drizzle relational queries only name relations that exist', () => {
  it('the schema relations were parsed (guards the parser itself)', () => {
    expect(Object.keys(RELS).length).toBeGreaterThan(20);
    expect([...RELS.Structure]).toEqual(expect.arrayContaining(['proRdvServices', 'rdvSettings', 'sourceDocument']));
    expect(RELS.Structure.has('proServices')).toBe(false);
  });
  it('no db.query.X.find*({ with: { <unknown> } }) in api/ or src/', () => {
    const bad = [];
    let seen = 0;
    for (const f of [...walk(path.join(ROOT, 'api')), ...walk(path.join(ROOT, 'src'))]) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/db\.query\.(\w+)\.find(?:First|Many)\(/g)) {
        const i = t.indexOf('{', m.index + m[0].length - 1); if (i < 0) continue;
        const b = block(t, i); const w = b.match(/\bwith:\s*\{/); if (!w) continue;
        const wb = block(b, w.index + w[0].length - 1);
        for (const k of topKeys(wb)) { seen += 1; if (!(RELS[m[1]] && RELS[m[1]].has(k))) bad.push(`${path.relative(ROOT, f)}: ${m[1]}.${k}`); }
      }
    }
    expect(seen, 'the scan found relational queries').toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
  it('the single-structure handler uses the real relations and reads rdvSettings as an array', () => {
    const h = fs.readFileSync(path.join(ROOT, 'api/_handlers/structures.js'), 'utf8');
    expect(h).toMatch(/proRdvServices:\s*\{/); expect(h).not.toMatch(/\bproServices:\s*true/); expect(h).toMatch(/Array\.isArray\(rdvSettingsRaw\)/);
    expect(h, 'a query fault must not be reported as "not found"').toMatch(/Structure findFirst error[\s\S]{0,260}status\(500\)/);
  });
});
