// @ts-check
/**
 * G14-R4 — retention inside the HDS service (PROPOSED schedule, to approve with the retention policy): dossiers whose end date passed more than
 * <graceDays> days ago are erased with their files, threads and grants; grants past their end date stop opening; spent ticket ids are purged.
 *
 *   node scripts/maintenance.js purge-expired [graceDays=30]
 * Runs inside the HDS app (scalingo run …, or a Scalingo scheduler entry once approved): the database URL never leaves the HDS environment. Output: counts only.
 */
import { createPool } from '../src/db.js';
import { purgeExpired } from '../src/sharing.js';

const url = String(process.env.DATABASE_URL || process.env.SCALINGO_POSTGRESQL_URL || '').trim();
const [cmd, grace] = process.argv.slice(2);
if (!url || cmd !== 'purge-expired') {
  process.stderr.write('usage: DATABASE_URL=… node scripts/maintenance.js purge-expired [graceDays]\n');
  process.exit(2);
}
const pool = createPool(url, { max: 1 });
try {
  process.stdout.write(`HDS_PURGE_EXPIRED ${JSON.stringify(await purgeExpired(pool, { graceDays: grace === undefined ? 30 : Number(grace) }))}\n`);
} finally { await pool.end(); }
