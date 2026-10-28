/**
 * DTA S1E — native full run ffcb44: `dta-attestation-authz-db` failed in its LAST assertion with "Failed query … actor_id = ANY(($1, $2, …))": drizzle renders `ANY(${jsArray})` as a ROW
 * constructor, which PostgreSQL rejects.  A TEST defect (the authorization assertions before it passed), but it hid the "denied requests leave no audit record" check.  Guard: no DTA integration test
 * may use `ANY(${…})` with a JS array; use `IN (${sql.join(…)})` or one query per id.  (Also proves, with the real drizzle dialect, what each form renders to.)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

describe('drizzle array parameters', () => {
  const d = new PgDialect(); const ids = ['a', 'b', 'c'];
  it('ANY(${array}) renders a row constructor (invalid in PostgreSQL); the joined IN list renders valid SQL', () => {
    expect(d.sqlToQuery(sql`SELECT 1 WHERE x = ANY(${ids})`).sql).toBe('SELECT 1 WHERE x = ANY(($1, $2, $3))');
    expect(d.sqlToQuery(sql`SELECT 1 WHERE x IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).sql).toBe('SELECT 1 WHERE x IN ($1, $2, $3)');
  });
  it('no DTA real-DB test uses ANY(${…}) with a JS array', () => {
    const dir = 'tests/integration';
    for (const f of readdirSync(dir).filter((n) => /^dta-.*\.test\.js$/.test(n))) {
      const lines = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
      expect(lines.filter((l) => /ANY\(\$\{/.test(l)), f).toEqual([]);
    }
  });
});
