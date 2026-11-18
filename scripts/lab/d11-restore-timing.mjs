#!/usr/bin/env node
/**
 * FA-D11 — LAB measurement of the restore path (RPO / RTO evidence), SYNTHETIC data only. It is NOT a Production restore: no Production dump, no
 * Production key, no Neon, no R2. Local PostgreSQL 17 (127.0.0.1:55434, trust auth), databases « ada_fa_d11_*_test », a loopback fake bucket
 * (tests/helpers/fake-s3.mjs) and a loopback healthcheck receiver.
 *
 *   node --import tsx scripts/lab/d11-restore-timing.mjs --out <evidence.json> [--filler-rows N] [--erased-before 5] [--erased-after 20] [--keep]
 *
 * Steps, each timed (evidence = counts, sizes and durations — never a value of the database, never a key):
 *   1 source database: every migration of drizzle/ (stock drizzle migrate), R45 synthetic seed, N synthetic filler audit rows (to reach a dump size)
 *   2 erasures BEFORE the backup through the application's privacy engine (they land in the erasure ledger)
 *   3 producer = scripts/cloud-backup.mjs --run (the K3 producer job's script): ADAB2 dump + sidecar + signed ledger into the fake bucket
 *   4 erasures AFTER the backup (only the tombstones know them; in-memory KV snapshot written to a 0600 file)
 *   5 verifier = scripts/cloud-restore-verify.mjs --keep-restored (the K3 verifier job's script) into an EMPTY database: download, signatures, restore,
 *     migration history, ledger dry run
 *   6 operator: scripts/db-deploy-migrate.mjs --lab-rehearsal --check on the restored copy
 *   7 operator: scripts/db-erasure-replay.mjs dry run, --execute (tsx, the DSR engine), dry run again (nothing left)
 *   8 clean-up (databases dropped, key files removed) unless --keep
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedRealistic } from './r45-synthetic-seed.mjs';
import { startFakeS3 } from '../../tests/helpers/fake-s3.mjs';
import { generateBackupKeyPair } from '../db-backup.mjs';
import { generateSigningKeyPair } from '../lib/backup-bucket.mjs';
import * as schema from '../../src/db/schema.js';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';
import { createErasureTombstones } from '../../api/_services/erasure-tombstones.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const OUT = arg('--out');
if (!OUT) { console.error('D11 {"ok":false,"reason":"--out is required"}'); process.exit(3); }
const FILLER = Number(arg('--filler-rows', '0'));
const ERASED_BEFORE = Number(arg('--erased-before', '5'));
const ERASED_AFTER = Number(arg('--erased-after', '20'));
const ADMIN = 'postgresql://postgres@127.0.0.1:55434/postgres';
const tag = crypto.randomBytes(3).toString('hex');
const DB = { SRC: `ada_fa_d11_src_${tag}_test`, RST: `ada_fa_d11_rst_${tag}_test` };
const url = (db) => { const u = new URL(ADMIN); u.pathname = `/${db}`; return u.toString(); };
const target = (db) => `127.0.0.1/${db}`;
const admin = async (sql) => { const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); try { return await c.query(sql); } finally { await c.end(); } };
const now = () => Number(process.hrtime.bigint() / 1000000n);
const timings = {}; const checks = {};
const timed = async (name, fn) => { const t0 = now(); try { return await fn(); } finally { timings[name] = now() - t0; } };

/** in-memory KV standing for Upstash (same surface as tests/integration/v2-erasure-tombstone-interval.test.js) */
const memoryKv = () => { const m = new Map(); return { isRemote: true,
  async lpush(k, v) { const l = m.get(k) || []; l.unshift(v); m.set(k, l); return l.length; },
  async lrange(k, a, b) { const l = m.get(k) || []; return l.slice(a, b < 0 ? l.length + b + 1 : b + 1); },
  async ltrim(k, a, b) { const l = m.get(k) || []; m.set(k, l.slice(a, b < 0 ? l.length + b + 1 : b + 1)); return 'OK'; },
  async expire() { return 1; }, async set(k, v) { m.set(k, v); return 'OK'; }, async get(k) { return m.get(k) ?? null; },
  async del(k) { m.delete(k); return 1; } }; };

const node = (script, args, env, pre = []) => new Promise((resolve) => {
  const c = spawn(process.execPath, [...pre, path.join(ROOT, 'scripts', script), ...args], { env: { PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', PG_BIN: process.env.PG_BIN || '', ...env }, cwd: ROOT });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => { let out = {}; try { out = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || '{}'); } catch { out = {}; } resolve({ status, out, all: `${stdout}\n${stderr}` }); });
});

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-d11-')); fs.chmodSync(work, 0o700);
let s3; let evs3; let hcServer; let pool; let ok = false; const notes = [];
const evidence = { kind: 'ada-fa-d11-restore-timing', labSynthetic: true, startedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, node: process.version } };
try {
  // 1 source
  await admin(`CREATE DATABASE ${DB.SRC}`); await admin(`CREATE DATABASE ${DB.RST}`);
  // the Production shape (ledger 51 rows since 17/11/2026): stock drizzle 0000..0042, then the deploy runner (--only 0045, plain run 0046..) — 0043 / 0044
  // stay unapplied for good, exactly as in Production
  await timed('1a-migrate', async () => {
    const MIG = path.join(ROOT, 'drizzle'); const journal = JSON.parse(fs.readFileSync(path.join(MIG, 'meta', '_journal.json'), 'utf8'));
    const staged = path.join(work, 'mig0042'); fs.mkdirSync(path.join(staged, 'meta'), { recursive: true });
    const entries = journal.entries.filter((e) => e.idx <= 42);
    for (const e of entries) fs.copyFileSync(path.join(MIG, `${e.tag}.sql`), path.join(staged, `${e.tag}.sql`));
    fs.writeFileSync(path.join(staged, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
    const p = new pg.Pool({ connectionString: url(DB.SRC), max: 2 }); try { await migrate(drizzle(p), { migrationsFolder: staged }); } finally { await p.end(); }
    const t45 = journal.entries.find((e) => e.tag.startsWith('0045_')).tag;
    for (const args of [['--lab-rehearsal', '--only', t45], ['--lab-rehearsal']]) {
      const r = await node('db-deploy-migrate.mjs', args, { DATABASE_URL_UNPOOLED: url(DB.SRC) });
      if (r.status !== 0) throw new Error(`deploy migrate ${args.join(' ')} exit ${r.status}`);
    }
  });
  pool = new pg.Pool({ connectionString: url(DB.SRC), max: 3 });
  await timed('1b-seed', async () => { const c = await pool.connect(); try { await seedRealistic(c); } finally { c.release(); } });
  if (FILLER > 0) {
    await timed('1c-filler', () => pool.query(`INSERT INTO "AuditLog" (id, action, actor, target, details, timestamp, entity, entity_id)
      SELECT 'd11-fill-' || g, 'SYNTHETIC_FILLER', 'd11-lab', 'd11-' || (g % 997), jsonb_build_object('a', md5(g::text), 'b', md5((g * 7)::text), 'n', g),
        now() - make_interval(secs => g), 'd11', 'd11-' || g FROM generate_series(1, $1) g`, [FILLER]));
  }
  const dbm = drizzle(pool, { schema });
  const kv = memoryKv();
  const svc = () => createPrivacyRightsService({ db: dbm, cryptoLib: crypto, tombstones: createErasureTombstones({ kv, requireRemote: true }) });
  const person = async () => { const id = crypto.randomUUID(); await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, 'x', now(), now())`, [id, `d11-${id}@example.test`]); return id; };
  const erase = async (id) => { const s = svc(); const r = await s.requestDeletion(id); await s.updateDsrRequestStatus(r.id, 'APPROVED'); await s.executeApprovedDeletion(r.id); };
  const before = []; const after = [];
  for (let i = 0; i < ERASED_BEFORE; i += 1) before.push(await person());
  for (let i = 0; i < ERASED_AFTER; i += 1) after.push(await person());
  // 2 erasures before the backup
  await timed('2-erasures-before', async () => { for (const id of before) await erase(id); });
  const src = (await pool.query(`SELECT pg_database_size(current_database())::bigint AS bytes, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations,
    (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables, (SELECT count(*)::int FROM "AuditLog") AS audit, (SELECT count(*)::int FROM "CitizenUser") AS citizens`)).rows[0];
  evidence.source = { databaseBytes: Number(src.bytes), migrations: src.migrations, tables: src.tables, auditRows: src.audit, citizens: src.citizens, fillerRows: FILLER };

  // 3 producer (K3 producer job script) into the fake bucket
  const passphrase = crypto.randomBytes(24).toString('hex'); const pair = generateBackupKeyPair(passphrase); const signing = generateSigningKeyPair();
  fs.writeFileSync(path.join(work, 'backup-private.pem'), pair.privatePem, { mode: 0o600 });
  const rw = { id: 'AKLABWRITER0000001', secret: crypto.randomBytes(20).toString('hex') }; const ro = { id: 'AKLABREADER0000001', secret: crypto.randomBytes(20).toString('hex') };
  s3 = await startFakeS3({ bucket: 'ada-backups-lab', keys: { [rw.id]: { write: true }, [ro.id]: { write: false } } });
  evs3 = await startFakeS3({ bucket: 'ada-restore-evidence-lab', keys: { AKLABEVIDENCE00001: { write: true } }, lockSeconds: 3600 });
  hcServer = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('OK')); }); await new Promise((r) => hcServer.listen(0, '127.0.0.1', r));
  const hc = `http://127.0.0.1:${hcServer.address().port}`;
  const producer = await timed('3-producer', () => node('cloud-backup.mjs', ['--run'], { DATABASE_URL: url(DB.SRC), BACKUP_PUBLIC_KEY: pair.publicPem, BACKUP_S3_ENDPOINT: s3.endpoint,
    BACKUP_S3_BUCKET: 'ada-backups-lab', BACKUP_S3_ACCESS_KEY_ID: rw.id, BACKUP_S3_SECRET_ACCESS_KEY: rw.secret, BACKUP_HEALTHCHECK_URL: `${hc}/producer`, BACKUP_SIGNING_KEY: signing.privatePem }));
  checks.producer = producer.status === 0 && producer.out.ok === true;
  if (!checks.producer) throw new Error(`producer failed: ${producer.out.code || producer.status}`);
  const dumpKey = producer.out.uploaded.find((u) => u.key.endsWith('.dump.enc')).key; const ledgerKey = producer.out.uploaded.find((u) => u.key.includes('ada_erasures_')).key;
  evidence.backup = { encryptedDumpBytes: producer.out.uploaded.find((u) => u.key === dumpKey).bytes, archiveBytes: producer.out.archiveBytes, ledgerErasures: producer.out.ledger?.erasures, producerSeconds: producer.out.seconds };

  // 4 erasures after the backup (tombstones only)
  await new Promise((r) => setTimeout(r, 1100));
  await timed('4-erasures-after', async () => { for (const id of after) await erase(id); });
  const tfile = path.join(work, 'tombstones.json'); fs.writeFileSync(tfile, JSON.stringify(await createErasureTombstones({ kv }).snapshot()), { mode: 0o600 });
  await pool.end(); pool = null;

  // 5 verifier (K3 verifier job script), kept restored
  const vEnv = { TARGET_DATABASE_URL: url(DB.RST), BACKUP_PRIVATE_KEY_FILE: path.join(work, 'backup-private.pem'), BACKUP_PRIVATE_KEY_PASSPHRASE: passphrase, BACKUP_S3_ENDPOINT: s3.endpoint,
    BACKUP_S3_BUCKET: 'ada-backups-lab', BACKUP_S3_ACCESS_KEY_ID: ro.id, BACKUP_S3_SECRET_ACCESS_KEY: ro.secret, RESTORE_HEALTHCHECK_URL: `${hc}/verifier`, BACKUP_SIGNING_PUBLIC_KEY: signing.publicPem,
    EVIDENCE_S3_ENDPOINT: evs3.endpoint, EVIDENCE_S3_BUCKET: 'ada-restore-evidence-lab', EVIDENCE_S3_ACCESS_KEY_ID: 'AKLABEVIDENCE00001', EVIDENCE_S3_SECRET_ACCESS_KEY: 'lab-evidence-secret' };
  const ver = await timed('5-verifier-restore', () => node('cloud-restore-verify.mjs', ['--key', dumpKey, '--confirm-target', target(DB.RST), '--expect-migrations', String(src.migrations), '--keep-restored'], vEnv));
  checks.verifier = ver.status === 0 && ver.out.ok === true;
  evidence.verifier = { ok: ver.out.ok, failures: ver.out.failures, restoredTables: ver.out.restoredTables, seconds: ver.out.seconds, migrationsMatch: ver.out.checks?.migrationsMatch, ledgerDryRunPresentAgain: ver.out.erasureReplay?.presentAgain };
  if (!checks.verifier) throw new Error(`verifier failed: ${JSON.stringify(ver.out.failures || ver.out.code)}`);

  // the operator downloads the same two objects (dump name gives the backup time; the ledger is decrypted with the private key)
  const dumpFile = path.join(work, path.basename(dumpKey)); fs.writeFileSync(dumpFile, s3.objects.get(dumpKey).body, { mode: 0o600 });
  const ledgerFile = path.join(work, path.basename(ledgerKey)); fs.writeFileSync(ledgerFile, s3.objects.get(ledgerKey).body, { mode: 0o600 });
  const keyEnv = { BACKUP_PRIVATE_KEY_FILE: path.join(work, 'backup-private.pem'), BACKUP_PRIVATE_KEY_PASSPHRASE: passphrase, TARGET_DATABASE_URL: url(DB.RST) };

  // 6 schema check on the restored copy
  const chk = await timed('6-migrate-check', () => node('db-deploy-migrate.mjs', ['--lab-rehearsal', '--check'], { DATABASE_URL_UNPOOLED: url(DB.RST) }));
  checks.migrateCheck = chk.status === 0;
  if (!checks.migrateCheck) notes.push(`migrate --check exit ${chk.status}: ${chk.all.split('\n').filter((l) => /DRIFT|FAIL|refus|error/i.test(l)).slice(0, 3).join(' | ')}`);

  // 7 erasure replay
  const base = ['--ledger', ledgerFile, '--since-backup', dumpFile, '--confirm-target', target(DB.RST), '--tombstones-file', tfile];
  const dry = await timed('7a-replay-dry', () => node('db-erasure-replay.mjs', base, keyEnv));
  const ex = await timed('7b-replay-execute', () => node('db-erasure-replay.mjs', [...base, '--execute'], keyEnv, ['--import', 'tsx']));
  const dry2 = await timed('7c-replay-dry-again', () => node('db-erasure-replay.mjs', base, keyEnv));
  evidence.replay = { dryPresentAgain: dry.out.presentAgain, tombstonesAdded: dry.out.tombstonesAdded, tombstoneProblems: dry.out.tombstoneProblems, executeStatus: ex.status,
    replayed: ex.out.replayed, failed: ex.out.failed, afterPresentAgain: dry2.out.presentAgain };
  checks.replay = dry.status === 0 && ex.status === 0 && ex.out.replayed === ERASED_AFTER && dry2.out.presentAgain === 0;
  if (!checks.replay) notes.push(`replay: ${ex.all.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400)}`);
  const restoredCitizens = async (ids) => { const c = new pg.Client({ connectionString: url(DB.RST) }); await c.connect(); try { return (await c.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = ANY($1)`, [ids])).rows[0].n; } finally { await c.end(); } };
  evidence.afterReplay = { erasedBeforePresent: await restoredCitizens(before), erasedAfterPresent: await restoredCitizens(after) };
  checks.nobodyBack = evidence.afterReplay.erasedBeforePresent === 0 && evidence.afterReplay.erasedAfterPresent === 0;
  ok = Object.values(checks).every(Boolean);
} catch (e) {
  notes.push(`error: ${String(e?.message || e).slice(0, 300)}`);
} finally {
  await pool?.end().catch(() => {});
  await s3?.close(); await evs3?.close(); if (hcServer) await new Promise((r) => hcServer.close(r));
  if (!process.argv.includes('--keep')) { for (const d of Object.values(DB)) await admin(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {}); }
  fs.rmSync(work, { recursive: true, force: true });
  const restoreMs = ['5-verifier-restore', '6-migrate-check', '7a-replay-dry', '7b-replay-execute', '7c-replay-dry-again'].reduce((s, k) => s + (timings[k] || 0), 0);
  Object.assign(evidence, { ok, checks, timingsMs: timings, restorePathMs: restoreMs, notes, finishedAt: new Date().toISOString(), databasesDropped: !process.argv.includes('--keep') });
  fs.writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`D11 ${JSON.stringify({ ok, restorePathMs: restoreMs, encryptedDumpBytes: evidence.backup?.encryptedDumpBytes, checks })}`);
  process.exit(ok ? 0 : 1);
}
