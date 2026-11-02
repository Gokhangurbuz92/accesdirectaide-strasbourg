#!/usr/bin/env node
/**
 * R35 (owner decision 4) — operator command: one restricted run of the existing verification chain so that the records made from FINESS receive their
 * authorized activities (finess.js activityServices) without waiting for the next full veille. Only the structure records whose source is the FINESS
 * register are checked (forced, today's official files from the cache directory, no language model); everything else is left untouched. Each record goes
 * through the usual D-5 path (publish / hold / withdraw with the register's evidence). Prints counts only, never a value.
 *
 *   DATABASE_URL=… node --import tsx scripts/finess-services-refresh.mjs --count-only        read-only: FINESS records, with services, published
 *   DATABASE_URL=… node --import tsx scripts/finess-services-refresh.mjs --apply        the run (take an encrypted backup first: scripts/db-backup.mjs)
 *   options: --cache-dir <dir> (default ~/.ada-lab/veille-cache)  --max-minutes 40
 */
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
if (!process.argv.includes('--count-only') && !process.argv.includes('--apply')) { process.stderr.write('choose --count-only or --apply\n'); process.exit(2); }
const { db } = await import('../src/db/index.js');
const { sql } = await import('drizzle-orm');
const count = async () => (await db.execute(sql`SELECT count(*)::int AS records, count(*) FILTER (WHERE cardinality(services) > 0)::int AS with_services,
  count(*) FILTER (WHERE statut = 'publie')::int AS published FROM "Structure" WHERE numero_finess IS NOT NULL AND source_url LIKE 'https://finess.esante.gouv.fr/%'`)).rows[0];
process.stdout.write(`BEFORE ${JSON.stringify(await count())}\n`);
if (process.argv.includes('--apply')) {
  const { runVeille } = await import('../api/_services/verification/chain.js');
  const fromFiness = (row) => Boolean(row.numero_finess) && String(row.source_url || '').startsWith('https://finess.esante.gouv.fr/');
  const r = await runVeille({ db, trigger: 'finess-services-refresh', only: ['structure'], select: (kind, row) => kind === 'structure' && fromFiness(row), force: true, texts: false,
    cacheDir: arg('--cache-dir', path.join(os.homedir(), '.ada-lab', 'veille-cache')), maxMinutes: Number(arg('--max-minutes', 40)) });
  process.stdout.write(`RUN ${JSON.stringify({ ok: r.ok, skipped: r.skipped || null, runId: r.runId || null })}\n`);
  process.stdout.write(`AFTER ${JSON.stringify(await count())}\n`);
}
process.exit(0);
