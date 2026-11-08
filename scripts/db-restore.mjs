#!/usr/bin/env node
/**
 * Restore of an encrypted backup made by scripts/db-backup.mjs (launch-readiness item 52). ADAB2 files (V2): BACKUP_PRIVATE_KEY_FILE + BACKUP_PRIVATE_KEY_PASSPHRASE
 * instead of BACKUP_ENCRYPTION_KEY.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> TARGET_DATABASE_URL=… node scripts/db-restore.mjs --file <x.dump.enc> --confirm-target <host>/<database>
 *       [--work-dir <private dir>] [--into-nonempty]
 *
 * Guards: the target is typed again (--confirm-target host/database) · the SHA-256 of the file is checked when its .sha256 exists · the GCM tag is checked
 * BEFORE pg_restore reads anything · an empty target is required unless --into-nonempty (then the objects of the backup are replaced: --clean --if-exists)
 * · the target comes from TARGET_DATABASE_URL, never from DATABASE_URL, so the running application's database is not the default.
 * R45 (restore rehearsal): the SHA-256 is streamed (a Production dump is not read into memory); the decrypted archive goes to --work-dir (a private
 * folder, e.g. on an encrypted volume) and is removed at the end; the archive is read by `pg_restore --list` BEFORE the target is touched (an unreadable
 * archive never starts a partial restore); the result says the tables, the migration history rows and the time the backup was taken (from its name),
 * so the operator can check the schema (scripts/db-deploy-migrate.mjs --check) and replay the erasures since that time (scripts/db-erasure-replay.mjs).
 * Output: counts only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { decryptionKeyFor, backupTimeOf, decryptFileToFile, pgEnv, removeOnExit, sidecarMatches, workDir } from './db-backup.mjs';
import { isMainModule } from './lib/is-main.mjs';

const die = (m) => { console.error(`db-restore : ${m}`); process.exit(1); };
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const pgBin = (tool) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, tool) : tool);

/** host/database of a connection string, without credentials */
export function targetName(url) { try { const u = new URL(url); return `${u.hostname}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`.toLowerCase(); } catch { return ''; } }

async function main() {
  const url = process.env.TARGET_DATABASE_URL || die('TARGET_DATABASE_URL absente (la cible est toujours explicite).');
  const file = arg('file') || die('indiquez --file <sauvegarde.dump.enc>.');
  const want = targetName(url);
  if (!arg('confirm-target')) die(`indiquez --confirm-target ${want}.`);
  if (arg('confirm-target').toLowerCase() !== want) die('la cible confirmée ne correspond pas à TARGET_DATABASE_URL : rien n’est restauré.');
  if (!fs.existsSync(file)) die('fichier de sauvegarde introuvable.');
  const key = (() => { try { return decryptionKeyFor(file); } catch (e) { return die(e.message); } })();   // V2: ADAB1 (BACKUP_ENCRYPTION_KEY) or ADAB2 (private key)
  if (await sidecarMatches(file) === false) die('empreinte SHA-256 différente : le fichier a changé.');
  const work = workDir();

  const intoNonEmpty = process.argv.includes('--into-nonempty');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  let tables = 0;
  try { tables = (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n; } finally { await c.end(); }
  if (tables > 0 && !intoNonEmpty) die(`la cible contient déjà ${tables} table(s) : restaurez dans une base vide, ou ajoutez --into-nonempty pour remplacer les objets de la sauvegarde.`);

  const tmp = fs.mkdtempSync(path.join(work, 'ada-restore-'));
  removeOnExit(tmp);
  try {
    const archive = path.join(tmp, 'archive.dump');
    try { await decryptFileToFile(file, archive, key); } catch { die('déchiffrement refusé (clé différente ou fichier modifié) : rien n’est restauré.'); }
    const list = spawnSync(pgBin('pg_restore'), ['--list', archive], { encoding: 'utf8' });
    if (list.status !== 0) die('archive illisible par pg_restore : rien n’est restauré.');
    const args = ['--no-owner', '--no-privileges', '--exit-on-error', ...(intoNonEmpty ? ['--clean', '--if-exists'] : []), archive];
    const r = spawnSync(pgBin('pg_restore'), ['--dbname', pgEnv(url).PGDATABASE, ...args], { encoding: 'utf8', env: { ...process.env, ...pgEnv(url) } });
    if (r.status !== 0) die(`pg_restore a échoué (code ${r.status}) : la base cible peut être partiellement restaurée — recommencez dans une base vide.`);
    const c2 = new pg.Client({ connectionString: url }); await c2.connect();
    try {
      const after = (await c2.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
      const hist = (await c2.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS e`)).rows[0].e
        ? (await c2.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n : 0;
      console.log(JSON.stringify({ restoredInto: want, tables: after, migrationRows: hist, backupTakenAt: backupTimeOf(file) }));
    } finally { await c2.end(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) main().catch(() => die('erreur inattendue (aucune donnée affichée).'));
