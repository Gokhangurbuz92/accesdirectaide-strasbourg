#!/usr/bin/env node
/**
 * V2 C7 — independent restore verification of the cloud backups (verifier). Runs in a SEPARATE job from the producer: it holds the private key and a
 * READ-ONLY bucket token; the producer holds neither. Target: an EMPTY, isolated, disposable database (never Production, never DATABASE_URL).
 *
 *   BACKUP_S3_* (read-only token) BACKUP_PRIVATE_KEY_FILE BACKUP_PRIVATE_KEY_PASSPHRASE BACKUP_SIGNING_PUBLIC_KEY TARGET_DATABASE_URL=<empty disposable db> PG_BIN=…
 *   node scripts/cloud-restore-verify.mjs --confirm-target <host>/<database> [--key <prefix/object>] [--expect-migrations N (optional since RA-08: the expected history is derived from the journal)] [--evidence <file.json>] [--keep-restored]
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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sha256OfFile } from './db-backup.mjs';
import { bucketConfig, bucketPlan, getFile, ledgerForDump, listObjects, objectTime, ping, pingUrl, putFile, s3Client, signingPublicKey, verifyObjectSignature } from './lib/backup-bucket.mjs';
import { isMainModule } from './lib/is-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
/** tables whose absence means the copy is not an AccesDirectAide database (structure only; nothing is read from them) */
export const CORE_TABLES = Object.freeze(['CitizenUser', 'AuditLog', 'DSRRequest', 'Aide']);

export function expectedMigrations(root = path.join(HERE, '..')) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'drizzle', 'meta', '_journal.json'), 'utf8')).entries.length; } catch { return null; }
}

/**
 * RA-08 — the migrations that Production never applies (superseded by 0045; scripts/db-migrate-guard.mjs pins them, tests/unit/ra08-restore-migrations.test.js
 * keeps this list equal to the guard's). They may be absent from a restored history without being a hole.
 */
export const MAY_BE_ABSENT = Object.freeze(['0043_r38_guest_booking', '0044_r39_guest_reminder_consent']);

/** the journal entries shipped with the release ({ tag, when }), or null @param {string} [root] */
export function journalEntries(root = path.join(HERE, '..')) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'drizzle', 'meta', '_journal.json'), 'utf8')).entries.map((/** @type {any} */ e) => ({ tag: String(e.tag), when: Number(e.when) })); } catch { return null; }
}

/**
 * RA-08 (pure) — what the restored history must be, DERIVED from the journal instead of an operator-typed count: every restored row is a journal entry
 * (no unknown or duplicated migration), and every journal entry older than the newest restored one is restored too, except the declared obsolete ones.
 * The database may lag the journal (a release can ship a migration that is applied later): the tail is not required.
 * @param {{ tag: string, when: number }[] | null} journal @param {number[] | null | undefined} whens `created_at` of the restored rows
 * @returns {{ derived: boolean, ok: boolean | null, expected: number | null, highest: string | null, unknown: number, duplicates: number, missing: string[] }}
 */
export function deriveMigrationExpectation(journal, whens, mayBeAbsent = MAY_BE_ABSENT) {
  if (!journal || !Array.isArray(whens)) return { derived: false, ok: null, expected: null, highest: null, unknown: 0, duplicates: 0, missing: [] };
  const byWhen = new Map(journal.map((e) => [e.when, e.tag])); const seen = new Set(whens);
  const unknown = whens.filter((w) => !byWhen.has(w)).length; const duplicates = whens.length - seen.size;
  const top = whens.length ? Math.max(...whens.filter((w) => byWhen.has(w)), -Infinity) : -Infinity;
  const below = journal.filter((e) => e.when <= top);
  const missing = below.filter((e) => !seen.has(e.when) && !mayBeAbsent.includes(e.tag)).map((e) => e.tag);
  const expected = below.filter((e) => seen.has(e.when) || !mayBeAbsent.includes(e.tag)).length;
  return { derived: true, ok: whens.length > 0 && unknown === 0 && duplicates === 0 && missing.length === 0, expected, highest: byWhen.get(top) ?? null, unknown, duplicates, missing };
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

/**
 * Which evidence fields are proven how (final data-integrity review, 09/11/2026). `verified`: checked cryptographically by THIS job (digest recomputed,
 * producer signatures, AES-GCM tag at decryption); `measured`: observed by this job on the restored copy; `fromSignedName`: read from the object name,
 * which the producer's signature covers; `notProven`: what no check here establishes (the signature proves origin, not that the dump is complete).
 */
export const ATTESTATION = Object.freeze({
  verified: Object.freeze(['dumpSha256', 'dumpSignature', 'ledgerSignature', 'gcmTag']),
  measured: Object.freeze(['encryptedBytes', 'restoredTables', 'checks.coreTablesMissing', 'checks.migrationRows', 'erasureReplay', 'wiped', 'seconds']),
  fromSignedName: Object.freeze(['backupTakenAt', 'backupAgeHours']),
  notProven: Object.freeze(['dumpCompleteness']),
});

/**
 * Durable evidence, automatic and independent of any personal computer: an OPTIONAL second bucket (EVIDENCE_S3_*, same EU-jurisdiction rules, its own
 * token scoped to that bucket only) receiving one small JSON per run (counts, codes, digests, object names — no personal data). The Healthchecks log
 * keeps only the last 100 events per check: it is a notification channel, not the archive. When configured, a run whose evidence cannot be stored
 * FAILS (EVIDENCE_NOT_STORED → Healthchecks /fail). The backups bucket is refused here: the verifier's backup token must stay read-only.
 * @param {Record<string, string | undefined>} env
 */
export function evidenceStoreConfig(env = process.env) {
  const names = ['EVIDENCE_S3_ENDPOINT', 'EVIDENCE_S3_BUCKET', 'EVIDENCE_S3_ACCESS_KEY_ID', 'EVIDENCE_S3_SECRET_ACCESS_KEY'];
  if (!names.some((k) => String(env[k] || '').trim())) return null;
  const c = bucketConfig({ BACKUP_S3_ENDPOINT: env.EVIDENCE_S3_ENDPOINT, BACKUP_S3_BUCKET: env.EVIDENCE_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID: env.EVIDENCE_S3_ACCESS_KEY_ID,
    BACKUP_S3_SECRET_ACCESS_KEY: env.EVIDENCE_S3_SECRET_ACCESS_KEY, BACKUP_S3_PREFIX: 'evidence/' });
  if (!c.ok) return { ...c, reason: `EVIDENCE_${c.reason}`, ...(c.missing ? { missing: c.missing.map((m) => m.replace('BACKUP_S3_', 'EVIDENCE_S3_')) } : {}) };
  if (String(env.EVIDENCE_S3_BUCKET).trim() === String(env.BACKUP_S3_BUCKET || '').trim()) return { ok: false, reason: 'EVIDENCE_BUCKET_SAME_AS_BACKUPS' };
  return c;
}

async function storeEvidence(/** @type {any} */ ecfg, /** @type {any} */ ev) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-evidence-')); fs.chmodSync(dir, 0o700);
  try {
    // milliseconds + random suffix: two runs never share a key (a later run must never overwrite an earlier record)
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const key = `${ecfg.prefix}ada_restore_evidence_${stamp}_${crypto.randomBytes(4).toString('hex')}_${ev.ok ? 'ok' : 'fail'}.json`;
    const file = path.join(dir, 'e.json'); fs.writeFileSync(file, `${JSON.stringify(ev, null, 2)}\n`, { mode: 0o600 });
    await putFile(await s3Client(ecfg), ecfg, file, key, await sha256OfFile(file));
    return key;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
  const ecfg = evidenceStoreConfig();
  if (ecfg && !ecfg.ok) throw Object.assign(new Error('CONFIG'), { code: 'CONFIG', problems: [ecfg.reason, ...(ecfg.missing || [])] });
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
    // RA-08: the expected history is DERIVED from the journal shipped with this release and the restored rows themselves (deriveMigrationExpectation):
    // no number to maintain by hand at each migration. Production never applies the obsolete 0043 / 0044 and may lag the journal. An explicit count
    // (--expect-migrations, or RESTORE_EXPECT_MIGRATIONS in the job) is still honoured when given — an additional, stricter check, no longer required.
    const expect = Number(arg('expect-migrations') || process.env.RESTORE_EXPECT_MIGRATIONS) || null;
    const journal = expectedMigrations();
    const derived = deriveMigrationExpectation(journalEntries(), restore.migrationWhens);
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
      migrationsPlausible: restore.migrationRows > 0 && (journal === null || restore.migrationRows <= journal),
      migrationsDerived: derived.derived ? { ok: derived.ok, expected: derived.expected, highest: derived.highest, unknown: derived.unknown, duplicates: derived.duplicates, missing: derived.missing } : null,
      ledger: Boolean(ledgerKey) };
    const failures = [];
    if (!hasSidecar) failures.push('SIDECAR_MISSING');
    if (core.length) failures.push('CORE_TABLES_MISSING');
    if (checks.migrationsMatch === false || !checks.migrationsPlausible || derived.ok === false) failures.push('MIGRATIONS_MISMATCH');
    if (!ledgerKey) failures.push('LEDGER_MISSING');
    const evidence = { kind: 'ada-restore-verification', ok: failures.length === 0, failures, verifiedAt: new Date().toISOString(), dump: dumpKey, backupTakenAt: restore.backupTakenAt,
      backupAgeHours: plan.ageHours, encryptedBytes: fs.statSync(dumpFile).size, dumpSha256: digest, restoredTables: restore.tables, checks,
      erasureReplay: replay ? { mode: replay.mode, ledgerEntries: replay.ledgerEntries, presentAgain: replay.presentAgain, holdsMissing: replay.holdsMissing } : null,
      seconds: Math.round((Date.now() - t0) / 1000), attestation: ATTESTATION };
    if (!process.argv.includes('--keep-restored')) {
      evidence.wiped = (await wipeTarget(target)) === 0;
      restoredSomething = false;
      if (!evidence.wiped) { evidence.ok = false; evidence.failures.push('WIPE_FAILED'); }
    } else evidence.wiped = false;
    if (ecfg) {
      try { evidence.evidenceStored = await storeEvidence(ecfg, evidence); }
      catch { evidence.evidenceStored = null; evidence.ok = false; evidence.failures.push('EVIDENCE_NOT_STORED'); }
    }
    await ping(hc, evidence.ok ? '' : '/fail', JSON.stringify(evidence));
    return evidence;
  } catch (e) {
    const err = /** @type {any} */ (e);
    const code = err?.code && /^[A-Z_]+$/.test(err.code) ? err.code : 'UNEXPECTED';
    // failure path: wipe BEFORE reporting, so the durable record (Healthchecks log) states whether a copy was left behind
    let wiped = null;
    if (restoredSomething && !process.argv.includes('--keep-restored')) { wiped = (await wipeTarget(target).catch(() => -1)) === 0; restoredSomething = !wiped; }
    const failure = { kind: 'ada-restore-verification', ok: false, code, stage: err?.stage || null, wiped, verifiedAt: new Date().toISOString() };
    if (ecfg?.ok) { try { failure.evidenceStored = await storeEvidence(ecfg, failure); } catch { failure.evidenceStored = null; } }
    await ping(hc, '/fail', JSON.stringify(failure));
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
