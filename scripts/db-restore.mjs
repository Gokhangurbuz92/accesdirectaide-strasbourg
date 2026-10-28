#!/usr/bin/env node
/**
 * Restore of an encrypted backup made by scripts/db-backup.mjs (launch-readiness item 52).
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> TARGET_DATABASE_URL=… node scripts/db-restore.mjs --file <x.dump.enc> --confirm-target <host>/<database> [--into-nonempty]
 *
 * Guards: the target is typed again (--confirm-target host/database) · the SHA-256 of the file is checked when its .sha256 exists · the GCM tag is checked
 * BEFORE pg_restore reads anything · an empty target is required unless --into-nonempty (then the objects of the backup are replaced: --clean --if-exists)
 * · the target comes from TARGET_DATABASE_URL, never from DATABASE_URL, so the running application's database is not the default.
 * Output: counts only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { backupKey, decryptFileToFile, pgEnv } from './db-backup.mjs';

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
  const key = (() => { try { return backupKey(); } catch (e) { return die(e.message); } })();
  const side = `${file}.sha256`;
  if (fs.existsSync(side) && fs.readFileSync(side, 'utf8').split(/\s+/)[0] !== crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')) die('empreinte SHA-256 différente : le fichier a changé.');

  const intoNonEmpty = process.argv.includes('--into-nonempty');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  let tables = 0;
  try { tables = (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n; } finally { await c.end(); }
  if (tables > 0 && !intoNonEmpty) die(`la cible contient déjà ${tables} table(s) : restaurez dans une base vide, ou ajoutez --into-nonempty pour remplacer les objets de la sauvegarde.`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-restore-'));
  try {
    const archive = path.join(tmp, 'archive.dump');
    try { await decryptFileToFile(file, archive, key); } catch { die('déchiffrement refusé (clé différente ou fichier modifié) : rien n’est restauré.'); }
    const args = ['--no-owner', '--no-privileges', '--exit-on-error', ...(intoNonEmpty ? ['--clean', '--if-exists'] : []), archive];
    const r = spawnSync(pgBin('pg_restore'), ['--dbname', pgEnv(url).PGDATABASE, ...args], { encoding: 'utf8', env: { ...process.env, ...pgEnv(url) } });
    if (r.status !== 0) die(`pg_restore a échoué (code ${r.status}) : la base cible peut être partiellement restaurée — recommencez dans une base vide.`);
    const c2 = new pg.Client({ connectionString: url }); await c2.connect();
    try {
      const after = (await c2.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
      console.log(JSON.stringify({ restoredInto: want, tables: after }));
    } finally { await c2.end(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch(() => die('erreur inattendue (aucune donnée affichée).'));
