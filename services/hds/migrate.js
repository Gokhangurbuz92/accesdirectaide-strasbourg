// @ts-check
/** G14-R3 — applies the HDS migrations (Scalingo `postdeploy: node migrate.js`; LAB: DATABASE_URL=… node services/hds/migrate.js). */
import { createPool, migrate } from './src/db.js';

const url = String(process.env.DATABASE_URL || process.env.SCALINGO_POSTGRESQL_URL || '').trim();
if (!url) { process.stderr.write('DATABASE_URL|SCALINGO_POSTGRESQL_URL missing\n'); process.exit(1); }
const pool = createPool(url, { max: 1 });
try {
  const applied = await migrate(pool);
  process.stdout.write(`HDS_MIGRATE ${JSON.stringify({ applied })}\n`);
} catch (e) {
  process.stderr.write(`HDS_MIGRATE_FAILED ${String(/** @type {any} */ (e).code || /** @type {Error} */ (e).name)}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
