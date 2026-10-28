#!/usr/bin/env node
/**
 * Encrypted logical backup of the whole database (launch-readiness item 52) — it replaces the former cron/backup-db export (a partial JSON copy of a few
 * tables, in clear, with IP addresses, never expired and never restorable). In production the primary protection is the provider's point-in-time recovery;
 * this is the second, provider-independent copy, and the LAB's backup before any migration.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> DATABASE_URL=… node scripts/db-backup.mjs --out <directory> [--label lab]
 *   … node scripts/db-backup.mjs --verify <file.dump.enc>          decrypts in memory-backed temp, checks the tag and the archive (pg_restore --list)
 *   … node scripts/db-backup.mjs --list <directory> [--keep-days 35] [--prune]
 *
 * Format: "ADAB1" ‖ iv(12) ‖ AES-256-GCM(pg_dump -Fc) ‖ tag(16). The key never touches the disk here; the file is 0600 with a .sha256 of the ciphertext.
 * Old backups are only LISTED by default; --prune deletes the encrypted files older than --keep-days, and only with that explicit flag.
 * Output: names, sizes, counts — never a value of the database, the key or the connection string.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const MAGIC = Buffer.from('ADAB1');
const IV_LEN = 12; const TAG_LEN = 16;
const die = (m) => { console.error(`db-backup : ${m}`); process.exit(1); };
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const pgBin = (tool) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, tool) : tool);

/** @param {string | undefined} hex */
export function backupKey(hex = process.env.BACKUP_ENCRYPTION_KEY) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(hex || ''))) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (distinct from ADA_ENCRYPTION_KEY)');
  return Buffer.from(String(hex), 'hex');
}

/** Encrypts a readable stream into a file (0600), with backpressure. @returns {Promise<{ bytes: number }>} */
export function encryptStreamToFile(input, file, key) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const out = fs.createWriteStream(file, { mode: 0o600 });
    let bytes = 0;
    out.write(Buffer.concat([MAGIC, iv]));
    input.on('data', (c) => { bytes += c.length; });
    input.on('error', reject); cipher.on('error', reject); out.on('error', reject);
    cipher.on('end', () => out.end(cipher.getAuthTag()));
    out.on('finish', () => resolve({ bytes }));
    input.pipe(cipher).pipe(out, { end: false });
  });
}

/**
 * Decrypts a backup file into `target` (0600), streaming. The result is written to a temporary name and renamed only once the GCM tag has been checked:
 * nothing unauthenticated is ever left under the target name.
 */
export function decryptFileToFile(file, target, key) {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(file).size;
    if (size < MAGIC.length + IV_LEN + TAG_LEN) return reject(new Error('not an AccesDirectAide encrypted backup'));
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(MAGIC.length + IV_LEN); fs.readSync(fd, head, 0, head.length, 0);
    const tag = Buffer.alloc(TAG_LEN); fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN); fs.closeSync(fd);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) return reject(new Error('not an AccesDirectAide encrypted backup'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    const tmp = `${target}.partial`;
    const out = fs.createWriteStream(tmp, { mode: 0o600 });
    let bytes = 0;
    const fail = (e) => { out.destroy(); fs.rmSync(tmp, { force: true }); reject(e); };
    decipher.on('data', (c) => { bytes += c.length; });
    decipher.on('error', fail); out.on('error', fail);
    out.on('finish', () => { fs.renameSync(tmp, target); resolve({ bytes }); });
    fs.createReadStream(file, { start: head.length, end: size - TAG_LEN - 1 }).on('error', fail).pipe(decipher).pipe(out);
  });
}

/** libpq environment for a connection string: the password never appears in a process argument list. */
export function pgEnv(url) {
  const u = new URL(url);
  const env = { PGHOST: u.hostname.replace(/^\[|\]$/g, ''), PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode'); if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function backup() {
  const url = process.env.DATABASE_URL || die('DATABASE_URL absente.');
  const key = (() => { try { return backupKey(); } catch (e) { return die(e.message); } })();
  const outDir = arg('out') || die('indiquez --out <dossier>.');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const label = String(arg('label', 'db')).replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'db';
  const file = path.join(outDir, `ada_${label}_${stamp()}.dump.enc`);
  const dump = spawn(pgBin('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...pgEnv(url) } });
  let err = ''; dump.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => dump.on('close', r));
  const { bytes } = await encryptStreamToFile(dump.stdout, file, key);
  const code = await exited;
  if (code !== 0) { fs.rmSync(file, { force: true }); die(`pg_dump a échoué (code ${code})${/password|authentication/i.test(err) ? ' : authentification' : ''}.`); }
  fs.writeFileSync(`${file}.sha256`, `${sha256File(file)}  ${path.basename(file)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ file, archiveBytes: bytes, encryptedBytes: fs.statSync(file).size }));
}

async function verify() {
  const file = arg('verify') || die('indiquez le fichier.');
  const key = (() => { try { return backupKey(); } catch (e) { return die(e.message); } })();
  const side = `${file}.sha256`;
  if (fs.existsSync(side) && fs.readFileSync(side, 'utf8').split(/\s+/)[0] !== sha256File(file)) die('empreinte SHA-256 différente : le fichier a changé.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-verify-'));
  try {
    const target = path.join(tmp, 'archive.dump');
    try { await decryptFileToFile(file, target, key); } catch { die('déchiffrement refusé (clé différente ou fichier modifié).'); }
    const list = spawnSync(pgBin('pg_restore'), ['--list', target], { encoding: 'utf8' });
    if (list.status !== 0) die('archive illisible par pg_restore.');
    const entries = list.stdout.split('\n').filter((l) => /^\d+;/.test(l));
    console.log(JSON.stringify({ file, ok: true, tables: entries.filter((l) => / TABLE DATA /.test(l)).length, entries: entries.length }));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function listOrPrune() {
  const dir = arg('list') || die('indiquez le dossier.');
  const keepDays = Number(arg('keep-days', '35'));
  const prune = process.argv.includes('--prune');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dump.enc')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
  const old = files.filter((x) => Date.now() - x.t > keepDays * 86400000);
  if (prune) for (const x of old) { fs.rmSync(path.join(dir, x.f)); fs.rmSync(path.join(dir, `${x.f}.sha256`), { force: true }); }
  console.log(JSON.stringify({ dir, total: files.length, olderThanKeepDays: old.length, keepDays, pruned: prune ? old.length : 0, newest: files.at(-1)?.f || null }));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--verify')) verify().catch(() => die('erreur inattendue (aucune donnée affichée).'));
  else if (process.argv.includes('--list')) listOrPrune();
  else backup().catch(() => die('erreur inattendue (aucune donnée affichée).'));
}
