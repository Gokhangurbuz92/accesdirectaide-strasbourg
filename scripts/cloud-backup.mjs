#!/usr/bin/env node
/**
 * V2 C7 — the cloud-only backup job (producer). Runs in a scheduled container (ops/cloud-backup/), never on the owner's computer.
 *
 *   node scripts/cloud-backup.mjs --run [--label prod] [--prune]     one backup: dump → ADAB2 → erasure ledger → upload → confirm → retention → ping
 *   node scripts/cloud-backup.mjs --status                           bucket only: freshness, counts, retention (no database access)
 *   node scripts/cloud-backup.mjs --check-config                     which variables are missing or invalid (names only)
 *
 * Holds: DATABASE_URL (a READ-ONLY Neon role), BACKUP_PUBLIC_KEY (it can encrypt, never decrypt: the private key is not in this job), the bucket token
 * (scripts/lib/backup-bucket.mjs) and optionally BACKUP_HEALTHCHECK_URL (dead-man's switch: /start, success, /fail; a run that never happens is reported by
 * the monitor itself). Deletion of old objects is the bucket's lifecycle rule (35 days); --prune is the fallback for a store without lifecycle rules. A
 * run also FAILS (after its own backup is safely stored) when the previous backup was older than BACKUP_MAX_AGE_HOURS (a missed run) or when objects are
 * older than the retention + 2 days (the lifecycle rule is not working).
 * Output: one JSON line — counts, sizes, ages, object names (timestamps only). Never a value of the database, a key or a credential.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { backupPublicKey, sha256OfFile } from './db-backup.mjs';
import { RETENTION_POLICY, policyDays } from '../api/_services/retention-policy.js';
import { bucketConfig, bucketPlan, deleteKeys, listObjects, ping, pingUrl, putFile, s3Client } from './lib/backup-bucket.mjs';
import { isMainModule } from './lib/is-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };

/** configuration check (names and reasons only) @param {Record<string, string | undefined>} env */
export function producerConfig(env = process.env) {
  const problems = [];
  const b = bucketConfig(env);
  if (!b.ok) problems.push(b.missing ? `${b.reason}:${b.missing.join(',')}` : b.reason);
  if (!String(env.DATABASE_URL || '').trim()) problems.push('DATABASE_URL_MISSING');
  else {
    try {
      const u = new URL(String(env.DATABASE_URL));
      const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname);
      if (!local && u.searchParams.get('sslmode') !== 'require' && u.searchParams.get('sslmode') !== 'verify-full') problems.push('DATABASE_URL_SSLMODE_REQUIRED');
      if (/-pooler\./.test(u.hostname)) problems.push('DATABASE_URL_POOLED_HOST');   // pg_dump needs a direct (unpooled) Neon endpoint
    } catch { problems.push('DATABASE_URL_INVALID'); }
  }
  try { backupPublicKey(env.BACKUP_PUBLIC_KEY); } catch { problems.push('BACKUP_PUBLIC_KEY_INVALID'); }
  if (String(env.BACKUP_PRIVATE_KEY_FILE || '').trim() || String(env.BACKUP_PRIVATE_KEY_PASSPHRASE || '').trim() || String(env.BACKUP_ENCRYPTION_KEY || '').trim()) problems.push('DECRYPTION_KEY_PRESENT_IN_PRODUCER');
  if (pingUrl(env.BACKUP_HEALTHCHECK_URL) === false) problems.push('BACKUP_HEALTHCHECK_URL_INVALID');
  const maxAge = Number(env.BACKUP_MAX_AGE_HOURS || 36);
  if (!Number.isFinite(maxAge) || maxAge < 6 || maxAge > 168) problems.push('BACKUP_MAX_AGE_HOURS_INVALID');
  return { ok: problems.length === 0, problems, maxAgeHours: maxAge, keepDays: policyDays(RETENTION_POLICY, 'BACKUP_KEEP_DAYS') };
}

/** runs one of the existing scripts as a child (same env), returns its JSON line; throws a CODE (never the child's stderr, which could name a host) */
function runScript(script, args, code) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8', env: process.env, maxBuffer: 1 << 20 });
  if (r.status !== 0) throw Object.assign(new Error(code), { code, stage: script, exit: r.status });
  const line = String(r.stdout).trim().split('\n').filter(Boolean).pop() || '{}';
  try { return JSON.parse(line); } catch { throw Object.assign(new Error(code), { code }); }
}

async function run() {
  const t0 = Date.now();
  const cfgCheck = producerConfig();
  const hc = pingUrl(process.env.BACKUP_HEALTHCHECK_URL) || null;
  if (!cfgCheck.ok) { await ping(hc, '/fail', JSON.stringify({ code: 'CONFIG', problems: cfgCheck.problems })); throw Object.assign(new Error('CONFIG'), { code: 'CONFIG', problems: cfgCheck.problems }); }
  const cfg = /** @type {Extract<ReturnType<typeof bucketConfig>, { ok: true }>} */ (bucketConfig());
  await ping(hc, '/start');
  const label = String(arg('label', 'prod')).replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'prod';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-cloud-backup-'));
  fs.chmodSync(tmp, 0o700);
  try {
    const client = await s3Client(cfg);
    const before = bucketPlan(await listObjects(client, cfg), { keepDays: cfgCheck.keepDays, maxAgeHours: cfgCheck.maxAgeHours });
    const dump = runScript('db-backup.mjs', ['--out', tmp, '--label', label], 'DUMP_FAILED');
    runScript('db-backup.mjs', ['--check-header', dump.file], 'HEADER_CHECK_FAILED');
    const ledger = runScript('db-erasure-replay.mjs', ['--export', '--out', tmp], 'LEDGER_EXPORT_FAILED');
    const uploads = [];
    for (const f of [dump.file, `${dump.file}.sha256`, ledger.file]) {
      const key = `${cfg.prefix}${path.basename(f)}`;
      uploads.push({ key, bytes: await putFile(client, cfg, f, key, await sha256OfFile(f)) });
    }
    const after = bucketPlan(await listObjects(client, cfg), { keepDays: cfgCheck.keepDays, maxAgeHours: cfgCheck.maxAgeHours });
    let pruned = 0;
    if (process.argv.includes('--prune') && after.prune.length) pruned = await deleteKeys(client, cfg, after.prune);
    const alerts = [];
    if (before.dumps > 0 && !before.fresh) alerts.push('PREVIOUS_RUN_MISSED');
    if (!process.argv.includes('--prune') && after.overdue > 0) alerts.push('RETENTION_OVERDUE');
    if (after.newestDump !== uploads[0].key) alerts.push('NEWEST_NOT_THIS_RUN');
    const summary = { ok: alerts.length === 0, alerts, format: dump.format, archiveBytes: dump.archiveBytes, uploaded: uploads, ledger: { erasures: ledger.erasures, legalHolds: ledger.legalHolds },
      previousAgeHours: before.ageHours, dumpsInBucket: after.dumps, ledgersInBucket: after.ledgers, bucketBytes: after.totalBytes, pruned, toPrune: after.prune.length - pruned,
      keepDays: cfgCheck.keepDays, euJurisdiction: cfg.euJurisdiction, seconds: Math.round((Date.now() - t0) / 1000) };
    await ping(hc, alerts.length ? '/fail' : '', JSON.stringify(summary));
    return summary;
  } catch (e) {
    const err = /** @type {any} */ (e);
    const code = err?.code && /^[A-Z_]+$/.test(err.code) ? err.code : (err?.name === 'AccessDenied' || err?.$metadata?.httpStatusCode === 403 ? 'BUCKET_ACCESS_DENIED' : 'UNEXPECTED');
    await ping(hc, '/fail', JSON.stringify({ code, stage: err?.stage || null }));
    throw Object.assign(new Error(code), { code, stage: err?.stage || null });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function status() {
  const cfgCheck = producerConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://status-only@127.0.0.1/x', BACKUP_PUBLIC_KEY: process.env.BACKUP_PUBLIC_KEY || STATUS_DUMMY_KEY() });
  const b = bucketConfig();
  if (!b.ok) throw Object.assign(new Error('CONFIG'), { code: 'CONFIG', problems: [b.reason, ...(b.missing || [])] });
  const plan = bucketPlan(await listObjects(await s3Client(b), b), { keepDays: cfgCheck.keepDays, maxAgeHours: cfgCheck.maxAgeHours });
  return { ...plan, prune: plan.prune.length, euJurisdiction: b.euJurisdiction };
}
const STATUS_DUMMY_KEY = () => crypto.generateKeyPairSync('rsa', { modulusLength: 3072 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();

if (isMainModule(import.meta.url)) {
  const out = (o) => console.log(JSON.stringify(o));
  const fail = (e) => { out({ ok: false, code: e?.code || 'UNEXPECTED', stage: e?.stage || null, problems: e?.problems || undefined }); process.exitCode = 1; };
  if (process.argv.includes('--check-config')) { const c = producerConfig(); out(c); process.exitCode = c.ok ? 0 : 1; }
  else if (process.argv.includes('--status')) status().then(out, fail);
  else if (process.argv.includes('--run')) run().then((s) => { out(s); process.exitCode = s.ok ? 0 : 1; }, fail);
  else { console.error('usage: --run [--label prod] [--prune] | --status | --check-config'); process.exitCode = 2; }
}
