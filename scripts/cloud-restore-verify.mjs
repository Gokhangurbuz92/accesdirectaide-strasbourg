#!/usr/bin/env node
/**
 * V2 C7 — independent restore verification of the cloud backups (verifier). Runs in a SEPARATE job from the producer: it holds the private key and a
 * READ-ONLY bucket token; the producer holds neither. Target: an EMPTY, isolated, disposable database (never Production, never DATABASE_URL).
 *
 *   BACKUP_S3_* (read-only token) BACKUP_PRIVATE_KEY_FILE BACKUP_PRIVATE_KEY_PASSPHRASE BACKUP_SIGNING_PUBLIC_KEY TARGET_DATABASE_URL=<empty disposable db> PG_BIN=…
 *   node scripts/cloud-restore-verify.mjs --confirm-target <host>/<database> [--key <prefix/object>] [--expect-migrations N (Production 0042: 43)] [--evidence <file.json>] [--keep-restored]
 *
 * Steps: newest dump (or --key) → download to a private folder → SHA-256 sidecar + object digest → db-restore.mjs (GCM tag checked before pg_restore,
 * empty target required) → structure checks (public tables, migration history = expected count, core tables present) → erasure ledger exported at or
 * after the dump → db-erasure-replay.mjs DRY RUN (how many erased people the restore brought back: they must be replayed before any use of the copy).
 * Evidence: one JSON document, counts, digests and object names only — no row content, no personal data, no credential. The job's container is
 * ephemeral, so the DURABLE record is the Healthchecks.io ping body (success and failure, same JSON; kept in the check's log) plus the job log;
 * the operator copies it to CONTROL/v2/c7/EVIDENCE_<date>.json and checks it with scripts/check-restore-evidence.mjs. --evidence only helps local runs.
 * Data minimisation: the restored copy is WIPED at the end, success or failure (schemas public and drizzle dropped), unless --keep-restored (a real
 * recovery, typed by an operator). The next monthly run therefore starts again from an empty target.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sha256OfFile } from './db-backup.mjs';
import { bucketConfig, bucketPlan, getFile, ledgerForDump, listObjects, objectTime, ping, pingUrl, s3Client, signingPublicKey, verifyObjectSignature } from './lib/backup-bucket.mjs';
import { isMainModule } from './lib/is-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
/** tables whose absence means the copy is not an AccesDirectAide database (structure only; nothing is read from them) */
export const CORE_TABLES = Object.freeze(['CitizenUser', 'AuditLog', 'DSRRequest', 'Aide']);

export function expectedMigrations(root = path.join(HERE, '..')) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'drizzle', 'meta', '_journal.json'), 'utf8')).entries.length; } catch { return null; }
}

function child(script, args, code, env = process.env) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8', env, maxBuffer: 1 << 20 });
  if (r.status !== 0) throw Object.assign(new Error(code), { code, stage: script });
  return JSON.parse(String(r.stdout).trim().split('\n').filter(Boolean).pop() || '{}');
}

/** drops what a restore created (public + drizzle schemas), leaving an empty target; returns the number of public tables left (0) */
export async function wipeTarget(url) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await c.query('DROP SCHEMA IF EXISTS public CASCADE');
    await c.query('CREATE SCHEMA public');
    return (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
  } finally { await c.end(); }
}

export async function verifyRestore() {
  const t0 = Date.now();
  const cfg = bucketConfig();
  if (!cfg.ok) throw Object.assign(new Error('CONFIG'), { code: 'CONFIG', problems: [cfg.reason, ...(cfg.missing || [])] });
  if (process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL_PRESENT'), { code: 'DATABASE_URL_PRESENT' });   // the verifier never sees the live database
  // provenance: only objects signed by the producer's key are restored (the verifier holds the PUBLIC half only)
  if (String(process.env.BACKUP_SIGNING_KEY || '').trim()) throw Object.assign(new Error('SIGNING_KEY_PRESENT_IN_VERIFIER'), { code: 'SIGNING_KEY_PRESENT_IN_VERIFIER' });
  let sigKey; try { sigKey = signingPublicKey(process.env.BACKUP_SIGNING_PUBLIC_KEY); } catch { throw Object.assign(new Error('CONFIG'), { code: 'CONFIG', problems: ['BACKUP_SIGNING_PUBLIC_KEY_INVALID'] }); }
  const target = process.env.TARGET_DATABASE_URL || '';
  if (!target) throw Object.assign(new Error('TARGET_MISSING'), { code: 'TARGET_MISSING' });
  const hc = pingUrl(process.env.RESTORE_HEALTHCHECK_URL) || null;
  await ping(hc, '/start');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-restore-verify-'));
  fs.chmodSync(work, 0o700);
  let restoredSomething = false;
  try {
    const client = await s3Client(cfg);
    const objects = await listObjects(client, cfg);
    const plan = bucketPlan(objects, { keepDays: 35, maxAgeHours: 36 });
    const dumpKey = arg('key') || plan.newestDump;
    if (!dumpKey || objectTime(dumpKey).kind !== 'dump') throw Object.assign(new Error('NO_DUMP'), { code: 'NO_DUMP' });
    const dumpFile = path.join(work, path.basename(dumpKey));
    const meta = await getFile(client, cfg, dumpKey, dumpFile);
    const hasSidecar = objects.some((o) => o.key === `${dumpKey}.sha256`);
    if (hasSidecar) await getFile(client, cfg, `${dumpKey}.sha256`, `${dumpFile}.sha256`);
    const digest = await sha256OfFile(dumpFile);
    if (meta.sha256 && meta.sha256 !== digest) throw Object.assign(new Error('OBJECT_DIGEST_MISMATCH'), { code: 'OBJECT_DIGEST_MISMATCH' });
    if (!verifyObjectSignature(sigKey, dumpKey, digest, meta.sig)) throw Object.assign(new Error('DUMP_SIGNATURE_INVALID'), { code: 'DUMP_SIGNATURE_INVALID' });
    restoredSomething = true;
    const restore = child('db-restore.mjs', ['--file', dumpFile, '--confirm-target', arg('confirm-target'), '--work-dir', work], 'RESTORE_FAILED');
    const c = new pg.Client({ connectionString: target }); await c.connect();
    let core; try {
      const r = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [CORE_TABLES]);
      core = CORE_TABLES.filter((t) => !r.rows.some((x) => x.table_name === t));
    } finally { await c.end(); }
    // Production never applies the obsolete 0043 / 0044 and may lag the journal (0042 today): equality only against the operator's explicit count
    // (--expect-migrations, or RESTORE_EXPECT_MIGRATIONS in the job); otherwise the history must be non-empty and not longer than the journal.
    const expect = Number(arg('expect-migrations') || process.env.RESTORE_EXPECT_MIGRATIONS) || null;
    const journal = expectedMigrations();
    const ledgerKey = ledgerForDump(objects, dumpKey);
    let replay = null;
    if (ledgerKey) {
      const ledgerFile = path.join(work, path.basename(ledgerKey));
      const lmeta = await getFile(client, cfg, ledgerKey, ledgerFile);
      if (!verifyObjectSignature(sigKey, ledgerKey, await sha256OfFile(ledgerFile), lmeta.sig)) throw Object.assign(new Error('LEDGER_SIGNATURE_INVALID'), { code: 'LEDGER_SIGNATURE_INVALID' });
      replay = child('db-erasure-replay.mjs', ['--ledger', ledgerFile, '--since-backup', dumpFile, '--confirm-target', arg('confirm-target')], 'REPLAY_DRY_RUN_FAILED');
    }
    const checks = { sidecar: hasSidecar, objectDigest: Boolean(meta.sha256), signatures: true, coreTablesMissing: core, migrationRows: restore.migrationRows, expectedMigrations: expect,
      journalEntries: journal, migrationsMatch: expect === null ? null : restore.migrationRows === expect,
      migrationsPlausible: restore.migrationRows > 0 && (journal === null || restore.migrationRows <= journal), ledger: Boolean(ledgerKey) };
    const failures = [];
    if (!hasSidecar) failures.push('SIDECAR_MISSING');
    if (core.length) failures.push('CORE_TABLES_MISSING');
    if (checks.migrationsMatch === false || !checks.migrationsPlausible) failures.push('MIGRATIONS_MISMATCH');
    if (!ledgerKey) failures.push('LEDGER_MISSING');
    const evidence = { kind: 'ada-restore-verification', ok: failures.length === 0, failures, verifiedAt: new Date().toISOString(), dump: dumpKey, backupTakenAt: restore.backupTakenAt,
      backupAgeHours: plan.ageHours, encryptedBytes: fs.statSync(dumpFile).size, dumpSha256: digest, restoredTables: restore.tables, checks,
      erasureReplay: replay ? { mode: replay.mode, ledgerEntries: replay.ledgerEntries, presentAgain: replay.presentAgain, holdsMissing: replay.holdsMissing } : null,
      seconds: Math.round((Date.now() - t0) / 1000) };
    if (!process.argv.includes('--keep-restored')) {
      evidence.wiped = (await wipeTarget(target)) === 0;
      restoredSomething = false;
      if (!evidence.wiped) { evidence.ok = false; evidence.failures.push('WIPE_FAILED'); }
    } else evidence.wiped = false;
    await ping(hc, evidence.ok ? '' : '/fail', JSON.stringify(evidence));
    return evidence;
  } catch (e) {
    const err = /** @type {any} */ (e);
    const code = err?.code && /^[A-Z_]+$/.test(err.code) ? err.code : 'UNEXPECTED';
    // failure path: wipe BEFORE reporting, so the durable record (Healthchecks log) states whether a copy was left behind
    let wiped = null;
    if (restoredSomething && !process.argv.includes('--keep-restored')) { wiped = (await wipeTarget(target).catch(() => -1)) === 0; restoredSomething = !wiped; }
    await ping(hc, '/fail', JSON.stringify({ kind: 'ada-restore-verification', ok: false, code, stage: err?.stage || null, wiped, verifiedAt: new Date().toISOString() }));
    throw Object.assign(new Error(code), { code, stage: err?.stage || null, problems: err?.problems, wiped });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    if (restoredSomething && !process.argv.includes('--keep-restored')) await wipeTarget(target).catch(() => {});   // failure path: never leave a copy behind
  }
}

if (isMainModule(import.meta.url)) {
  verifyRestore().then((ev) => {
    if (arg('evidence')) fs.writeFileSync(arg('evidence'), `${JSON.stringify(ev, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(ev)); process.exitCode = ev.ok ? 0 : 1;
  }, (e) => { console.log(JSON.stringify({ kind: 'ada-restore-verification', ok: false, code: e?.code || 'UNEXPECTED', stage: e?.stage || null, problems: e?.problems, wiped: e?.wiped ?? null })); process.exitCode = 1; });
}
