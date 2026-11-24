// @ts-check
/**
 * G14-R3 — anti-resurrection of erased subjects after a restore of the HDS database (art. 17 vs backups, G14_HDS_MIGRATION_PLAN.md § 7).
 *
 *   node scripts/tombstones.js export            prints the tombstones (sha256 of erased subject ids + dates; content-free) as JSON on stdout
 *   node scripts/tombstones.js reapply <file>    after a restore: erases again every subject listed in <file> (the JSON of « export », taken from
 *                                                the live database before the restore, or kept outside the HDS database)
 * Runs inside the HDS app (scalingo run …): the database URL never leaves the HDS environment.
 */
import fs from 'node:fs';
import { createPool } from '../src/db.js';
import { exportTombstones, reapplyTombstones } from '../src/service.js';

const url = String(process.env.DATABASE_URL || process.env.SCALINGO_POSTGRESQL_URL || '').trim();
const [cmd, file] = process.argv.slice(2);
if (!url || !['export', 'reapply'].includes(String(cmd)) || (cmd === 'reapply' && !file)) {
  process.stderr.write('usage: DATABASE_URL=… node scripts/tombstones.js export | reapply <file.json>\n');
  process.exit(2);
}
const pool = createPool(url, { max: 1 });
try {
  if (cmd === 'export') process.stdout.write(`${JSON.stringify(await exportTombstones(pool))}\n`);
  else {
    const list = JSON.parse(fs.readFileSync(String(file), 'utf8'));
    const out = await reapplyTombstones(pool, (Array.isArray(list) ? list : []).map((x) => String(x?.subjectHash || x)));
    process.stdout.write(`HDS_TOMBSTONES_REAPPLIED ${JSON.stringify(out)}\n`);
  }
} finally { await pool.end(); }
