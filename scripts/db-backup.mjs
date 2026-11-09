#!/usr/bin/env node
/**
 * Encrypted logical backup of the whole database (launch-readiness item 52) — it replaces the former cron/backup-db export (a partial JSON copy of a few
 * tables, in clear, with IP addresses, never expired and never restorable). In production the primary protection is the provider's point-in-time recovery;
 * this is the second, provider-independent copy, and the LAB's backup before any migration.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> DATABASE_URL=… node scripts/db-backup.mjs --out <directory> [--label lab]
 *   … node scripts/db-backup.mjs --verify <file.dump.enc> [--work-dir <private dir>]   checks the SHA-256 sidecar, the GCM tag, then the archive
 *                                                                  (pg_restore --list) on a 0600 temporary copy removed at the end
 *   … node scripts/db-backup.mjs --list <directory> [--keep-days N] [--keep-weekly W] [--prune]
 *
 * Format: "ADAB1" ‖ iv(12) ‖ AES-256-GCM(pg_dump -Fc) ‖ tag(16). The key never touches the disk here; the file is 0600 with a .sha256 of the ciphertext.
 * Old backups are only LISTED by default; --prune deletes, and only with that explicit flag. R44 / E15 rotation (rotationPlan): every backup of the last
 * --keep-days days is kept, plus the newest backup of each of the --keep-weekly most recent older weeks, and always the newest backup. The defaults are the
 * retention policy's PROPOSED values (api/_services/retention-policy.js: 30 days, 4 weekly) — while that policy is not approved, --prune also requires an
 * explicit --keep-days (the operator's own choice), and the output says the policy status. After a restore, replay the erasures: scripts/db-erasure-replay.mjs.
 * Output: names, sizes, counts — never a value of the database, the key or the connection string.
 *
 * V2 (Neon Free, unattended backups): a second format, "ADAB2", for a machine that must NOT be able to read its own backups (an automated runner):
 *   … node scripts/db-backup.mjs --keygen --out <offline dir>      (BACKUP_PRIVATE_KEY_PASSPHRASE ≥ 16 characters, typed hidden) writes
 *       backup-private.pem (RSA-4096, encrypted with the passphrase, 0600 — kept OFFLINE) and backup-public.pem (given to the runner).
 *   BACKUP_PUBLIC_KEY=<PEM> DATABASE_URL=… node scripts/db-backup.mjs --out <dir>     encrypts with a fresh data key wrapped by RSA-OAEP-SHA256.
 *   --verify / db-restore: BACKUP_PRIVATE_KEY_FILE=<pem> + BACKUP_PRIVATE_KEY_PASSPHRASE for ADAB2 files; BACKUP_ENCRYPTION_KEY for ADAB1 files.
 *   Format: "ADAB2" ‖ u16 length ‖ RSA-OAEP(data key) ‖ iv(12) ‖ AES-256-GCM(pg_dump -Fc) ‖ tag(16); the header is authenticated (GCM AAD).
 *   … node scripts/db-backup.mjs --check-header <file>   checks the magic, the wrapped-key length and the .sha256 sidecar WITHOUT any key (runner side).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { RETENTION_POLICY, isPolicyApproved, policyDays } from '../api/_services/retention-policy.js';
import { isMainModule } from './lib/is-main.mjs';
import { pemFromEnv } from './lib/backup-bucket.mjs';

export const MAGIC = Buffer.from('ADAB1');
export const MAGIC2 = Buffer.from('ADAB2');
const MIN_PASSPHRASE = 16;
const IV_LEN = 12; const TAG_LEN = 16;
const die = (m) => { console.error(`db-backup : ${m}`); process.exit(1); };
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const pgBin = (tool) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, tool) : tool);
/**
 * R45: where a decrypted archive is written while it is checked or restored (0600, removed at the end). Default: the system temporary folder; for a
 * Production dump the operator passes --work-dir on an encrypted volume (docs/runbooks.md § 4). The folder must exist and not be group/world-writable.
 */
export function workDir(dir = arg('work-dir')) {
  if (!dir) return os.tmpdir();
  let st; try { st = fs.statSync(dir); } catch { return die('--work-dir introuvable.'); }
  if (!st.isDirectory()) return die('--work-dir n’est pas un dossier.');
  if ((st.mode & 0o022) !== 0) return die('--work-dir est modifiable par d’autres utilisateurs : choisissez un dossier privé (0700).');
  return dir;
}

/**
 * R45: a decrypted archive is removed even when the script stops through die() (process.exit skips `finally`): before R45 a failing pg_restore left the
 * clear archive in the temporary folder. @param {string} dir
 */
export function removeOnExit(dir) { process.once('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }); }

/** @param {string | undefined} hex */
export function backupKey(hex = process.env.BACKUP_ENCRYPTION_KEY) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(hex || ''))) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (distinct from ADA_ENCRYPTION_KEY)');
  return Buffer.from(String(hex), 'hex');
}

/**
 * V2: the public key of an ADAB2 backup (PEM text, RSA ≥ 3072 bits). @param {string | undefined} pem
 * @returns {crypto.KeyObject}
 */
export function backupPublicKey(pem = process.env.BACKUP_PUBLIC_KEY) {
  let k; try { k = crypto.createPublicKey(pemFromEnv(pem)); } catch { throw new Error('BACKUP_PUBLIC_KEY is not a PEM public key'); }
  if (k.asymmetricKeyType !== 'rsa' || (k.asymmetricKeyDetails?.modulusLength || 0) < 3072) throw new Error('BACKUP_PUBLIC_KEY must be an RSA key of at least 3072 bits');
  return k;
}
/** V2: the private key of ADAB2 backups, from a PEM file encrypted with a passphrase. @returns {crypto.KeyObject} */
export function backupPrivateKey(file = process.env.BACKUP_PRIVATE_KEY_FILE, passphrase = process.env.BACKUP_PRIVATE_KEY_PASSPHRASE) {
  let pem; try { pem = fs.readFileSync(String(file || '')); } catch { throw new Error('BACKUP_PRIVATE_KEY_FILE not readable'); }
  try { return crypto.createPrivateKey({ key: pem, passphrase: String(passphrase || '') }); } catch { throw new Error('private key refused (wrong passphrase or not a key)'); }
}
/** V2: generates the ADAB2 key pair; the private key is encrypted with the passphrase. @returns {{ privatePem: string, publicPem: string }} */
export function generateBackupKeyPair(passphrase) {
  if (String(passphrase || '').length < MIN_PASSPHRASE) throw new Error(`BACKUP_PRIVATE_KEY_PASSPHRASE must have at least ${MIN_PASSPHRASE} characters`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }).toString(), publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}
/**
 * The key material for decryption: ADAB1 needs the 32-byte key, ADAB2 the private key. Resolved lazily so a run only needs the variables of its format.
 * @param {string} file
 */
export function decryptionKeyFor(file) {
  const head = Buffer.alloc(MAGIC.length); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
  return head.equals(MAGIC2) ? backupPrivateKey() : backupKey();
}

/**
 * Encrypts a readable stream into a file (0600), with backpressure. `key`: a 32-byte Buffer (ADAB1) or an RSA public KeyObject (ADAB2: a fresh data key,
 * wrapped with RSA-OAEP-SHA256; the whole header is GCM additional data). @returns {Promise<{ bytes: number }>}
 */
export function encryptStreamToFile(input, file, key) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(IV_LEN);
    let header; let dataKey = key;
    if (Buffer.isBuffer(key)) header = Buffer.concat([MAGIC, iv]);
    else {
      dataKey = crypto.randomBytes(32);
      const wrapped = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey);
      const len = Buffer.alloc(2); len.writeUInt16BE(wrapped.length);
      header = Buffer.concat([MAGIC2, len, wrapped, iv]);
    }
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    if (!Buffer.isBuffer(key)) cipher.setAAD(header);
    const out = fs.createWriteStream(file, { mode: 0o600, flags: 'wx' });   // V2: never overwrite an existing backup (two runs in the same second)
    let bytes = 0;
    out.write(header);
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
/**
 * Parses the header of an ADAB1 / ADAB2 file (no key needed). @param {string} file @param {number} size
 * @returns {{ v: 1 | 2, header: Buffer, iv: Buffer, wrapped?: Buffer, tag: Buffer }}
 */
export function readHeader(file, size = fs.statSync(file).size) {
  const fd = fs.openSync(file, 'r');
  try {
    const magic = Buffer.alloc(MAGIC.length); fs.readSync(fd, magic, 0, magic.length, 0);
    const tag = Buffer.alloc(TAG_LEN); fs.readSync(fd, tag, 0, TAG_LEN, Math.max(0, size - TAG_LEN));
    if (magic.equals(MAGIC)) {
      if (size < MAGIC.length + IV_LEN + TAG_LEN) throw new Error('not an AccesDirectAide encrypted backup');
      const header = Buffer.alloc(MAGIC.length + IV_LEN); fs.readSync(fd, header, 0, header.length, 0);
      return { v: 1, header, iv: header.subarray(MAGIC.length), tag };
    }
    if (magic.equals(MAGIC2)) {
      const len = Buffer.alloc(2); fs.readSync(fd, len, 0, 2, MAGIC2.length);
      const n = len.readUInt16BE(0);
      if (n < 384 || n > 1024 || size < MAGIC2.length + 2 + n + IV_LEN + TAG_LEN) throw new Error('not an AccesDirectAide encrypted backup');
      const header = Buffer.alloc(MAGIC2.length + 2 + n + IV_LEN); fs.readSync(fd, header, 0, header.length, 0);
      return { v: 2, header, wrapped: header.subarray(MAGIC2.length + 2, MAGIC2.length + 2 + n), iv: header.subarray(MAGIC2.length + 2 + n), tag };
    }
    throw new Error('not an AccesDirectAide encrypted backup');
  } finally { fs.closeSync(fd); }
}

export function decryptFileToFile(file, target, key) {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(file).size;
    if (size < MAGIC.length + IV_LEN + TAG_LEN) return reject(new Error('not an AccesDirectAide encrypted backup'));
    let head; let decipher;
    try {
      const parsed = readHeader(file, size);
      head = parsed.header;
      if (parsed.v === 1) {
        if (!Buffer.isBuffer(key)) throw new Error('an ADAB1 backup needs BACKUP_ENCRYPTION_KEY');
        decipher = crypto.createDecipheriv('aes-256-gcm', key, parsed.iv);
      } else {
        if (Buffer.isBuffer(key)) throw new Error('an ADAB2 backup needs the private key');
        const dataKey = crypto.privateDecrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, parsed.wrapped);
        decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, parsed.iv);
        decipher.setAAD(head);
      }
      decipher.setAuthTag(parsed.tag);
    } catch (e) { return reject(e); }
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

/** SHA-256 of a file, streamed (R45: a Production dump is not read into memory). @param {string} f @returns {Promise<string>} */
export function sha256OfFile(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
  });
}
/** R45: the .sha256 sidecar check, shared by --verify and db-restore. null = no sidecar; true = same; false = the file changed. @param {string} file */
export async function sidecarMatches(file) {
  const side = `${file}.sha256`;
  if (!fs.existsSync(side)) return null;
  return fs.readFileSync(side, 'utf8').split(/\s+/)[0] === await sha256OfFile(file);
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
/**
 * R45: the time a backup was TAKEN, from its name (ada_<label>_YYYYMMDDTHHMMSSZ.dump.enc, written by this script) — never from the file time, which a copy
 * changes. Used by db-erasure-replay.mjs --since-backup. @param {string} file @returns {string | null} ISO time, or null when the name carries none
 */
export function backupTimeOf(file) {
  const m = path.basename(String(file || '')).match(/_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.enc$/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const d = new Date(t);
  return Number.isFinite(t) && d.getUTCDate() === Number(m[3]) && d.getUTCMonth() === Number(m[2]) - 1 ? d.toISOString() : null;
}

async function backup() {
  const url = process.env.DATABASE_URL || die('DATABASE_URL absente.');
  const key = (() => { try { return process.env.BACKUP_PUBLIC_KEY ? backupPublicKey() : backupKey(); } catch (e) { return die(e.message); } })();
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
  fs.writeFileSync(`${file}.sha256`, `${await sha256OfFile(file)}  ${path.basename(file)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ file, format: Buffer.isBuffer(key) ? 'ADAB1' : 'ADAB2', archiveBytes: bytes, encryptedBytes: fs.statSync(file).size }));
}

/** V2 runner side: structure + sidecar, no key. */
async function checkHeader() {
  const file = arg('check-header') || die('indiquez le fichier.');
  let h; try { h = readHeader(file); } catch { return die('en-tête invalide : ce n’est pas une sauvegarde AccesDirectAide.'); }
  const side = await sidecarMatches(file);
  if (side !== true) die(side === null ? 'empreinte .sha256 absente.' : 'empreinte SHA-256 différente : le fichier a changé.');
  console.log(JSON.stringify({ file, ok: true, format: `ADAB${h.v}`, encryptedBytes: fs.statSync(file).size, takenAt: backupTimeOf(file) }));
}

function keygen() {
  const outDir = arg('out') || die('indiquez --out <dossier hors ligne>.');
  let pair; try { pair = generateBackupKeyPair(process.env.BACKUP_PRIVATE_KEY_PASSPHRASE); } catch (e) { return die(e.message); }
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const priv = path.join(outDir, 'backup-private.pem'); const pub = path.join(outDir, 'backup-public.pem');
  if (fs.existsSync(priv) || fs.existsSync(pub)) die('une paire existe déjà dans ce dossier : rien n’est écrasé.');
  fs.writeFileSync(priv, pair.privatePem, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(pub, pair.publicPem, { mode: 0o644, flag: 'wx' });
  console.log(JSON.stringify({ privateKey: priv, publicKey: pub, fingerprint: crypto.createHash('sha256').update(pair.publicPem).digest('hex').slice(0, 16) }));
}

async function verify() {
  const file = arg('verify') || die('indiquez le fichier.');
  const key = (() => { try { return decryptionKeyFor(file); } catch (e) { return die(e.message); } })();
  if (await sidecarMatches(file) === false) die('empreinte SHA-256 différente : le fichier a changé.');
  const tmp = fs.mkdtempSync(path.join(workDir(), 'ada-verify-'));
  removeOnExit(tmp);
  try {
    const target = path.join(tmp, 'archive.dump');
    try { await decryptFileToFile(file, target, key); } catch { die('déchiffrement refusé (clé différente ou fichier modifié).'); }
    const list = spawnSync(pgBin('pg_restore'), ['--list', target], { encoding: 'utf8' });
    if (list.status !== 0) die('archive illisible par pg_restore.');
    const entries = list.stdout.split('\n').filter((l) => /^\d+;/.test(l));
    console.log(JSON.stringify({ file, ok: true, tables: entries.filter((l) => / TABLE DATA /.test(l)).length, entries: entries.length, takenAt: backupTimeOf(file) }));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** ISO-like week key (UTC, weeks starting Monday) of a time in ms */
const weekKey = (/** @type {number} */ t) => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86400000) / (7 * 86400000)); };

/**
 * R44 / E15 — which backup files to keep and which to prune (pure). Keeps: every file of the last keepDays days; then the newest file of each of the
 * keepWeekly most recent older weeks; and always the newest file overall (a rotation never leaves zero backups).
 * @param {{ f: string, t: number }[]} files name and time (ms) @param {{ keepDays: number, keepWeekly: number, now?: number }} opts
 * @returns {{ keep: string[], prune: string[] }}
 */
export function rotationPlan(files, { keepDays, keepWeekly, now = Date.now() }) {
  if (!Number.isInteger(keepDays) || keepDays < 1 || !Number.isInteger(keepWeekly) || keepWeekly < 0) throw new Error('invalid rotation parameters');
  const sorted = [...files].sort((a, b) => b.t - a.t);   // newest first
  const keep = new Set();
  if (sorted[0]) keep.add(sorted[0].f);
  const weeks = new Set();
  for (const x of sorted) {
    if (now - x.t <= keepDays * 86400000) { keep.add(x.f); continue; }
    const w = weekKey(x.t);
    if (!weeks.has(w) && weeks.size < keepWeekly) { weeks.add(w); keep.add(x.f); }
  }
  return { keep: sorted.filter((x) => keep.has(x.f)).map((x) => x.f), prune: sorted.filter((x) => !keep.has(x.f)).map((x) => x.f) };
}

function listOrPrune() {
  const dir = arg('list') || die('indiquez le dossier.');
  const approved = isPolicyApproved(RETENTION_POLICY);
  const prune = process.argv.includes('--prune');
  if (prune && !approved && !arg('keep-days')) die(`la politique de conservation ${RETENTION_POLICY.version} n’est pas approuvée (${RETENTION_POLICY.status}) : indiquez --keep-days explicitement pour --prune.`);
  const keepDays = Number(arg('keep-days', String(policyDays(RETENTION_POLICY, 'BACKUP_KEEP_DAYS'))));
  const keepWeekly = Number(arg('keep-weekly', String(policyDays(RETENTION_POLICY, 'BACKUP_KEEP_WEEKLY'))));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dump.enc')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
  let plan;
  try { plan = rotationPlan(files, { keepDays, keepWeekly }); } catch (e) { return die(e.message); }
  if (prune) for (const f of plan.prune) { fs.rmSync(path.join(dir, f)); fs.rmSync(path.join(dir, `${f}.sha256`), { force: true }); }
  const newest = [...files].sort((a, b) => a.t - b.t).at(-1)?.f || null;
  console.log(JSON.stringify({ dir, total: files.length, keepDays, keepWeekly, kept: plan.keep.length, toPrune: plan.prune.length, olderThanKeepDays: files.filter((x) => Date.now() - x.t > keepDays * 86400000).length,
    pruned: prune ? plan.prune.length : 0, newest, policy: { version: RETENTION_POLICY.version, status: RETENTION_POLICY.status } }));
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--keygen')) keygen();
  else if (process.argv.includes('--check-header')) checkHeader().catch(() => die('erreur inattendue (aucune donnée affichée).'));
  else if (process.argv.includes('--verify')) verify().catch(() => die('erreur inattendue (aucune donnée affichée).'));
  else if (process.argv.includes('--list')) listOrPrune();
  else backup().catch(() => die('erreur inattendue (aucune donnée affichée).'));
}
