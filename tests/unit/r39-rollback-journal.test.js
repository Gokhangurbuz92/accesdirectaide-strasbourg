// R39 — a rollback file from 0043 on removes its own migration's journal row (drizzle.__drizzle_migrations, created_at = the journal « when »):
// without it, rollback + migrate silently skips the migration (R39 LAB rehearsal of 0043). Earlier rollbacks are documented in docs/database.md.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
describe('rollback files forget their migration', () => {
  for (const e of journal.filter((x) => x.idx >= 43)) {
    it(`${e.tag}`, () => {
      const file = `drizzle/rollback/${String(e.idx).padStart(4, '0')}_down.sql`;
      expect(fs.existsSync(file), file).toBe(true);
      const sql = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(sql).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${e.when};`);
    });
  }
});
