/**
 * K0 / C20 — static contract complementing dta-s4a-drizzle-relations-contract: every key of a `columns: { ... }` selection in `db.query.<Table>.find*({ ... })` (top level and
 * inside each `with` relation) must be a real column of that table in src/db/schema.ts.
 * Why: api/_handlers/public/passport.js and public/sms-notify.js asked for ProRdvService.label/mode and ProUser.firstName/lastName, which do not exist. Drizzle throws in JS before
 * any SQL, so the passport failed for every dossier WITH an appointment and the SMS opt-in always answered 500 — hidden because mocked tests never ran the real query builder.
 * Source-reading only: no database needed.
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
/** top-level `key:` entries of an object literal block, with the offset of their value */
const topEntries = (b) => { let depth = 0; const out = []; for (const m of b.matchAll(/[{}]|(\w+):/g)) { if (m[0] === '{') depth += 1; else if (m[0] === '}') depth -= 1; else if (depth === 1) out.push({ key: m[1], at: m.index + m[0].length }); } return out; };
const valueBlock = (b, at) => { const rest = b.slice(at).match(/^\s*\{/); return rest ? block(b, at + rest[0].length - 1) : ''; };

const schema = fs.readFileSync(path.join(ROOT, 'src/db/schema.ts'), 'utf8');
const COLS = {};
for (const m of schema.matchAll(/export const (\w+) = pgTable\('[^']+', \{/g)) {
  const b = block(schema, m.index + m[0].length - 1);
  COLS[m[1]] = new Set(topEntries(b).map((e) => e.key));
}
const TARGET = {};   // TARGET[Table][relation] = target table
for (const m of schema.matchAll(/export const (\w+)Relations = relations\((\w+), \(\{[^}]*\}\) => \(\{([\s\S]*?)\n\}\)\);/g)) {
  TARGET[m[2]] = Object.fromEntries([...m[3].matchAll(/^\s{1,2}(\w+): (?:one|many)\((\w+)/gm)].map((x) => [x[1], x[2]]));
}

describe('Drizzle relational queries only select columns that exist', () => {
  it('the schema tables and relation targets were parsed (guards the parser itself)', () => {
    expect(Object.keys(COLS).length).toBeGreaterThan(40);
    expect([...COLS.ProRdvService]).toEqual(expect.arrayContaining(['id', 'name', 'durationMinutes']));
    expect(COLS.ProRdvService.has('label')).toBe(false);
    expect(TARGET.ProAppointment.service).toBe('ProRdvService');
  });
  it('no db.query.X.find*({ columns | with: { rel: { columns } } }) names an unknown column in api/ or src/', () => {
    const bad = []; let seen = 0;
    for (const f of [...walk(path.join(ROOT, 'api')), ...walk(path.join(ROOT, 'src'))]) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/db\.query\.(\w+)\.find(?:First|Many)\(/g)) {
        const table = m[1]; const i = t.indexOf('{', m.index + m[0].length - 1); if (i < 0 || !COLS[table]) continue;
        const b = block(t, i);
        const check = (tbl, colsBlock, where) => { for (const e of topEntries(colsBlock)) { seen += 1; if (!COLS[tbl] || !COLS[tbl].has(e.key)) bad.push(`${path.relative(ROOT, f)}: ${where}.${e.key}`); } };
        for (const e of topEntries(b)) {
          if (e.key === 'columns') check(table, valueBlock(b, e.at), table);
          if (e.key === 'with') {
            const wb = valueBlock(b, e.at);
            for (const r of topEntries(wb)) {
              const rb = valueBlock(wb, r.at); const tgt = TARGET[table] && TARGET[table][r.key]; if (!rb || !tgt) continue;
              for (const x of topEntries(rb)) if (x.key === 'columns') check(tgt, valueBlock(rb, x.at), `${table}.${r.key}(${tgt})`);
            }
          }
        }
      }
    }
    expect(seen, 'the scan found column selections').toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
