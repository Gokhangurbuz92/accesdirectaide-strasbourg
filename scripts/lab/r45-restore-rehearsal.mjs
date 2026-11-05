#!/usr/bin/env node
/**
 * R45 / ENG-LR-7 — LAB restoration rehearsal with SYNTHETIC data, end to end, through the project's own scripts. It is NOT a Production restore: no
 * Production dump, no Production key, no Neon. Local PostgreSQL 17 only (127.0.0.1:55434, trust auth), databases « ada_r45_ops_*_test ».
 *
 *   node --import tsx scripts/lab/r45-restore-rehearsal.mjs --out <evidence dir> --work <private scratch dir> [--pg-bin <dir>] [--keep]
 *
 * Steps (each timed; each check PASS / FAIL; evidence = counts, names of steps, durations — never a value of the database, never the key):
 *   0 source database at the Production shape 0042 (stock drizzle migrate of 0000..0041, then 0000..0042: 43 history rows, 0043 / 0044 / 0045 never applied)
 *   1 synthetic seed (scripts/lab/r45-synthetic-seed.mjs)
 *   2 throwaway rehearsal key (32 random bytes, file 0600 in --work; never printed; shredded at the end)
 *   3 backup #1 (scripts/db-backup.mjs) + erasure ledger #1 (scripts/db-erasure-replay.mjs --export)
 *   4 integrity: SHA-256 sidecar, --verify (GCM tag + pg_restore --list), clear-text probe (a seeded e-mail never appears in the encrypted file)
 *   5 changes AFTER backup #1 through the application's services: one DSR erasure (privacy engine), one booking-message withdrawal, one new legal hold, one
 *     new restriction (art. 18); then backup #2 + ledger #2
 *   6 restore of the OLDER backup #1 into an empty database (scripts/db-restore.mjs, private --work-dir)
 *   7 schema verification: scripts/db-deploy-migrate.mjs --lab-rehearsal --check (journal, 43 rows, hashes, physical drift) + history rows identical to the
 *     source + object and row counts identical to the source at backup time
 *   8 functional smoke on the restored copy through service functions (booking configuration, notices, previous professionals, privacy export)
 *   9 replay after restoring the older backup: dry run, execute (protections first, then the DSR engine, then the withdrawal), dry run again (nothing left)
 *  10 purge after restore: the production policy (PROPOSED) runs as a dry run on the restored copy — zero writes
 *  11 failure cases: corrupted (sidecar / no sidecar), wrong key, truncated, not an archive, target not empty, mistyped target, ledger older than the
 *     backup — every one refused, the empty target untouched, no clear archive left in the work folder
 *  12 clean-up: databases dropped, key shredded, work files removed
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedRealistic, countAll, VOLUMES } from './r45-synthetic-seed.mjs';
import { sha256OfFile } from '../db-backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIG = path.join(ROOT, 'drizzle');
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
if (!arg('--out') || !arg('--work')) { console.error('REHEARSAL {"ok":false,"reason":"--out and --work are required"}'); process.exit(3); }
const OUT = path.resolve(String(arg('--out'))); const WORK = path.resolve(String(arg('--work')));
const PGBIN = String(arg('--pg-bin', '/opt/homebrew/opt/postgresql@17/bin'));
const keep = process.argv.includes('--keep');
const HOST = '127.0.0.1'; const PORT = '55434'; const USER = 'ada_test';
const DB = { SRC: 'ada_r45_ops_src_test', RST: 'ada_r45_ops_restore_test', FAIL: 'ada_r45_ops_fail_test' };
for (const n of Object.values(DB)) if (!/^ada_r45_ops_[a-z0-9_]+_test$/.test(n)) process.exit(3);
const url = (db) => `postgresql://${USER}@${HOST}:${PORT}/${db}`;
if (new URL(url(DB.SRC)).hostname !== '127.0.0.1') process.exit(3);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true, mode: 0o700 }); fs.chmodSync(WORK, 0o700);
const BK = path.join(WORK, 'backups'); const PRIV = path.join(WORK, 'restore-work'); const KEYFILE = path.join(WORK, 'rehearsal.key');
for (const d of [BK, PRIV]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); }

const checks = []; const timings = []; const commands = [];
const check = (step, label, ok, detail) => {
  const d = detail === undefined ? undefined : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  checks.push({ step, label, ok: Boolean(ok), ...(d ? { detail: d.slice(0, 1500) } : {}) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${step}] ${label}${d ? ` — ${d.slice(0, 240)}` : ''}`);
};
const timed = async (step, label, fn) => { const t0 = process.hrtime.bigint(); try { return await fn(); } finally { timings.push({ step, label, ms: Number((process.hrtime.bigint() - t0) / 1000000n) }); } };
async function withClient(db, fn) { const c = new pg.Client({ connectionString: url(db) }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const admin = (sqls) => withClient('postgres', async (c) => { for (const s of sqls) await c.query(s); });
const dropAll = () => admin(Object.values(DB).map((d) => `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`));
const emptyDb = async (db) => admin([`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, `CREATE DATABASE ${db} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`, `ALTER DATABASE ${db} SET timezone TO 'UTC'`]);
const publicTables = (db) => withClient(db, async (c) => Number((await c.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n));
const journalAll = JSON.parse(fs.readFileSync(path.join(MIG, 'meta', '_journal.json'), 'utf8'));
const stage = (name, maxIdx) => {
  const d = path.join(WORK, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(path.join(d, 'meta'), { recursive: true });
  const entries = journalAll.entries.filter((e) => e.idx <= maxIdx);
  for (const e of entries) fs.copyFileSync(path.join(MIG, `${e.tag}.sql`), path.join(d, `${e.tag}.sql`));
  fs.writeFileSync(path.join(d, 'meta', '_journal.json'), JSON.stringify({ ...journalAll, entries }, null, 2));
  return d;
};
const stockMigrate = async (db, folder) => { const pool = new pg.Pool({ connectionString: url(db), max: 2 }); try { await migrate(drizzle(pool), { migrationsFolder: folder }); } finally { await pool.end(); } };
const keyHex = () => fs.readFileSync(KEYFILE, 'utf8').trim();
const baseEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, PG_BIN: PGBIN, TZ: 'UTC' });
/** throwaway application secrets for THIS LAB process and its children (the services refuse to load without them); random, never printed, never kept */
const LAB_APP_ENV = Object.freeze(Object.fromEntries(['JWT_SECRET', 'AUTH_SECRET', 'ADA_ENCRYPTION_KEY', 'CRON_SECRET', 'ADMIN_TOKEN'].map((k) => [k, crypto.randomBytes(32).toString('hex')])));
Object.assign(process.env, LAB_APP_ENV, { NODE_ENV: 'test', VERCEL_ENV: 'development', ADA_PUBLIC_CONTENT_MODE: 'lab', OLLAMA_BASE_URL: 'http://127.0.0.1:9', LOG_LEVEL: 'silent' });
/** a project script as a child process; the key reaches it through its environment only; the log keeps the command shape and the exit code */
const script = (rel, args, env, { tsx = false } = {}) => {
  const argv = [...(tsx ? ['--import', 'tsx'] : []), rel, ...args];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...baseEnv(), ...(tsx ? LAB_APP_ENV : {}), ...env } });
  const shown = argv.map((a) => a.replace(WORK, '<work>')).join(' ');
  const envShown = Object.keys(env).map((k) => `${k}=<${k === 'BACKUP_ENCRYPTION_KEY' ? 'rehearsal key' : 'local LAB url'}>`).join(' ');
  const jsonLine = (r.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{'));
  commands.push({ cmd: `${envShown} node ${shown}`, exit: r.status, ms: Date.now() - t0, stderr: (r.stderr || '').trim().split('\n').at(-1)?.slice(0, 300) || '' });
  let json = null; try { json = jsonLine ? JSON.parse(jsonLine) : null; } catch { json = null; }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
};
const objectCounts = (db) => withClient(db, async (c) => {
  const one = async (s) => Number((await c.query(s)).rows[0].n);
  return {
    tables: await one(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`),
    columns: await one(`select count(*)::int n from information_schema.columns where table_schema = 'public'`),
    constraints: await one(`select count(*)::int n from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relnamespace = 'public'::regnamespace`),
    indexes: await one(`select count(*)::int n from pg_indexes where schemaname = 'public'`),
    functions: await one(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace`),
    triggers: await one(`select count(*)::int n from pg_trigger g join pg_class t on t.oid = g.tgrelid where not g.tgisinternal and t.relnamespace = 'public'::regnamespace`),
    enumTypes: await one(`select count(*)::int n from pg_type where typnamespace = 'public'::regnamespace and typtype = 'e'`),
    sequences: await one(`select count(*)::int n from pg_sequences where schemaname = 'public'`),
    extensions: (await c.query(`select string_agg(extname, ',' order by extname) s from pg_extension`)).rows[0].s,
  };
});
const history = (db) => withClient(db, async (c) => (await c.query('select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id')).rows);
const shred = (file) => { if (!fs.existsSync(file)) return; const n = fs.statSync(file).size; const fd = fs.openSync(file, 'r+'); for (let i = 0; i < 3; i++) { fs.writeSync(fd, crypto.randomBytes(Math.max(n, 64)), 0, Math.max(n, 64), 0); fs.fsyncSync(fd); } fs.closeSync(fd); fs.rmSync(file); };

async function main() {
  const startedAt = new Date().toISOString();
  await dropAll();
  // 0. source at the Production shape ---------------------------------------------------------------------------------------------------------
  await timed('0-source', 'create source DB at 0042 (two stock migrate runs like Production)', async () => {
    await emptyDb(DB.SRC);
    await withClient(DB.SRC, async (c) => { for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`); });
    await stockMigrate(DB.SRC, stage('upto41', 41)); await stockMigrate(DB.SRC, stage('upto42', 42));
  });
  const srcHist = await history(DB.SRC);
  const guest = await withClient(DB.SRC, async (c) => Number((await c.query(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'ProAppointment' and column_name like 'guest%'`)).rows[0].n));
  check('0-source', 'source = Production shape: 43 history rows, last 0042, no guest column (0043/0044 absent), 0045 not applied', srcHist.length === 43 && Number(srcHist.at(-1).created_at) === journalAll.entries[42].when && guest === 0, { rows: srcHist.length, guestColumns: guest });

  // 1. seed --------------------------------------------------------------------------------------------------------------------------------------
  const seeded = await timed('1-seed', 'synthetic seed', () => withClient(DB.SRC, (c) => seedRealistic(c)));
  check('1-seed', 'synthetic rows seeded (volumes: VOLUMES)', seeded.CitizenUser === VOLUMES.citizens && seeded.ProAppointment === VOLUMES.citizens * VOLUMES.appointmentsPerCitizen + VOLUMES.structureRecorded && seeded.AuditLog === VOLUMES.auditRows,
    { citizens: seeded.CitizenUser, appointments: seeded.ProAppointment, messages: seeded.RdvConversationMessage, consents: seeded.ConsentLog, audit: seeded.AuditLog, notices: seeded.AppointmentNotice });

  // the person who will withdraw a message after backup #1 has a future booking with a message (and its consent) in backup #1
  await withClient(DB.SRC, async (c) => {
    const { rows: [a] } = await c.query(`UPDATE "ProAppointment" SET notes = 'Message synthétique', status = 'confirmed', "cancelledAt" = NULL, "startAt" = now() + interval '5 days', "endAt" = now() + interval '5 days 30 minutes'
      WHERE id = (SELECT id FROM "ProAppointment" WHERE "citizenUserId" = 'r45-c-0030' ORDER BY id LIMIT 1) RETURNING id`);
    await c.query(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, created_at, collection_channel, guardian_involved, proof_level)
      VALUES ('r45-cl-msgw', 'r43-e6-2026-11-04', 'r43-e6-2026-11-04:BOOKING_MESSAGE_TRANSMISSION:' || $1, 'CITIZEN_USER', 'r45-c-0030', 'BOOKING_MESSAGE_TRANSMISSION', true, now(), 'booking', false, 'EXPLICIT_CHECKBOX')
      ON CONFLICT (id) DO NOTHING`, [a.id]);
  });

  // 2. throwaway key -----------------------------------------------------------------------------------------------------------------------------
  fs.writeFileSync(KEYFILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  check('2-key', 'rehearsal key generated in the work folder (0600, 64 hex, never printed, never the real backup key)', (fs.statSync(KEYFILE).mode & 0o777) === 0o600 && /^[0-9a-f]{64}$/.test(keyHex()));
  const KEYENV = () => ({ BACKUP_ENCRYPTION_KEY: keyHex() });

  // 3. backup #1 + ledger #1 ------------------------------------------------------------------------------------------------------------------
  /** @type {{ counts?: Record<string, number>, objects?: any }} */ const atBackup1 = {};
  atBackup1.counts = await withClient(DB.SRC, (c) => countAll(c));
  atBackup1.objects = await objectCounts(DB.SRC);
  const b1 = await timed('3-backup', 'backup #1 (pg_dump -Fc | AES-256-GCM)', () => script('scripts/db-backup.mjs', ['--out', BK, '--label', 'r45rehearsal'], { DATABASE_URL: url(DB.SRC), ...KEYENV() }));
  const file1 = b1.json?.file;
  check('3-backup', 'backup #1 written (exit 0, file 0600, .sha256 sidecar)', b1.status === 0 && file1 && (fs.statSync(file1).mode & 0o777) === 0o600 && fs.existsSync(`${file1}.sha256`),
    { archiveBytes: b1.json?.archiveBytes, encryptedBytes: b1.json?.encryptedBytes });
  const l1 = script('scripts/db-erasure-replay.mjs', ['--export', '--out', BK], { DATABASE_URL: url(DB.SRC), ...KEYENV() });
  check('3-backup', 'erasure ledger #1 exported with the backup (encrypted, counts only)', l1.status === 0 && l1.json?.file, { ...l1.json, file: undefined });

  // 4. integrity ---------------------------------------------------------------------------------------------------------------------------------
  const side = fs.readFileSync(`${file1}.sha256`, 'utf8').split(/\s+/)[0];
  check('4-integrity', 'SHA-256 of the encrypted file = its sidecar', side === await sha256OfFile(file1));
  const v1 = await timed('4-integrity', 'verify (sidecar + GCM tag + pg_restore --list)', () => script('scripts/db-backup.mjs', ['--verify', file1, '--work-dir', PRIV], KEYENV()));
  check('4-integrity', '--verify: tag authentic and archive listed by pg_restore', v1.status === 0 && v1.json?.ok === true && v1.json.tables > 100, { tables: v1.json?.tables, entries: v1.json?.entries, takenAt: v1.json?.takenAt });
  const probe = Buffer.from('test.citizen+r45-1@example.test');
  check('4-integrity', 'a seeded synthetic e-mail never appears in clear in the encrypted file', !fs.readFileSync(file1).includes(probe));
  check('4-integrity', 'no clear archive left in the work folder after --verify', fs.readdirSync(PRIV).length === 0);

  // 5. changes after backup #1, through the application -----------------------------------------------------------------------------------
  process.env.DATABASE_URL = url(DB.SRC);
  const [{ createPrivacyRightsService }, { withdrawBookingMessage }, schema] = await Promise.all([import('../../api/_services/privacy.js'), import('../../api/_services/rdv-message-consent.js'), import('../../src/db/schema.js')]);
  const ERASED = 'r45-c-0021'; const WITHDRAWER = 'r45-c-0030'; const HELD = 'r45-c-0040'; const RESTRICTED = 'r45-c-0050';
  const after = await timed('5-changes', 'post-backup changes on the source (erasure, withdrawal, hold, restriction)', async () => {
    const pool = new pg.Pool({ connectionString: url(DB.SRC), max: 3 });
    try {
      const db = drizzle(pool, { schema });
      const privacy = createPrivacyRightsService({ db, cryptoLib: crypto });
      const req = await privacy.requestDeletion(ERASED);
      await privacy.updateDsrRequestStatus(req.id, 'APPROVED');
      await privacy.executeApprovedDeletion(req.id);
      // a future appointment of WITHDRAWER with a message: the person withdraws it (application service)
      const apt = (await pool.query(`SELECT id FROM "ProAppointment" WHERE "citizenUserId" = $1 AND notes IS NOT NULL AND "startAt" > now() ORDER BY id LIMIT 1`, [WITHDRAWER])).rows[0];
      const w = await withdrawBookingMessage(WITHDRAWER, apt.id, { database: db });
      await pool.query(`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES ('r45-lh-after-backup', 'CitizenUser', $1, 'SYNTHETIC_LITIGATION', 'r45-admin-1', 'ACTIVE', now())`, [HELD]);
      await pool.query(`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt") VALUES ('r45-dsr-restrict-after', 'CITIZEN_USER', $1, 'RESTRICT', 'ACTIVE', 'HUMAN_REVIEW_REQUIRED', '[]', 'a', now())`, [RESTRICTED]);
      return { erasureRequestId: req.id, withdrawalStatus: w.status, appointmentId: apt.id,
        erasedGone: Number((await pool.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [ERASED])).rows[0].n) === 0 };
    } finally { await pool.end(); }
  });
  check('5-changes', 'after backup #1: DSR erasure completed by the privacy engine (account gone), message withdrawn (200), new hold, new restriction', after.erasedGone && after.withdrawalStatus === 200);
  await new Promise((r) => setTimeout(r, 1100));   // backup names carry the second
  const b2 = await timed('5-changes', 'backup #2', () => script('scripts/db-backup.mjs', ['--out', BK, '--label', 'r45rehearsal'], { DATABASE_URL: url(DB.SRC), ...KEYENV() }));
  const l2 = script('scripts/db-erasure-replay.mjs', ['--export', '--out', BK], { DATABASE_URL: url(DB.SRC), ...KEYENV() });
  check('5-changes', 'backup #2 and ledger #2 (v2: erasures, withdrawals, protections)', b2.status === 0 && l2.status === 0 && l2.json.erasures >= 2 && l2.json.messageWithdrawals >= 1 && l2.json.legalHolds >= 3 && l2.json.protectiveRequests >= 3,
    { ...l2.json, file: undefined });

  // 6. restore the OLDER backup ------------------------------------------------------------------------------------------------------------------
  await emptyDb(DB.RST);
  const host = `${HOST}/${DB.RST}`;
  const rs = await timed('6-restore', 'restore backup #1 into an empty database (decrypt + pg_restore)', () => script('scripts/db-restore.mjs', ['--file', file1, '--confirm-target', host, '--work-dir', PRIV], { TARGET_DATABASE_URL: url(DB.RST), ...KEYENV() }));
  check('6-restore', 'db-restore exit 0; tables, 43 migration rows and the backup time reported', rs.status === 0 && rs.json?.migrationRows === 43 && rs.json?.backupTakenAt, { tables: rs.json?.tables, migrationRows: rs.json?.migrationRows, backupTakenAt: rs.json?.backupTakenAt, stderr: rs.stderr.slice(0, 200) });
  check('6-restore', 'no clear archive left in the work folder after the restore', fs.readdirSync(PRIV).length === 0);

  // 7. schema verification -------------------------------------------------------------------------------------------------------------------------
  const chk = await timed('7-schema', 'db-deploy-migrate --lab-rehearsal --check on the restored copy', () => script('scripts/db-deploy-migrate.mjs', ['--lab-rehearsal', '--check'], { DATABASE_URL_UNPOOLED: url(DB.RST) }));
  const pre = (chk.stdout.split('\n').find((l) => l.startsWith('DB_DEPLOY_MIGRATE_PREFLIGHT ')) || '').slice('DB_DEPLOY_MIGRATE_PREFLIGHT '.length);
  let pf = null; try { pf = JSON.parse(pre); } catch { pf = null; }
  check('7-schema', 'migration guard on the restored copy: journal OK, history OK (43 rows, last 0042, hashes), physical drift none, plain plan still refused (0043/0044 pending)',
    pf?.journal?.ok && pf?.history?.ok && pf.history.rows === 43 && pf.history.lastApplied === '0042_r31_orientation_funding_pilot' && pf.drift?.ok && pf.plainPlan?.reason === 'OBSOLETE_MIGRATION_PENDING',
    { exit: chk.status, rows: pf?.history?.rows, lastApplied: pf?.history?.lastApplied, driftOk: pf?.drift?.ok, expectedObjects: pf?.drift?.expectedObjects, plan: pf?.plainPlan?.reason });
  const rstHist = await history(DB.RST);
  check('7-schema', 'history rows identical to the source (id, sha256 hash, created_at)', JSON.stringify(rstHist) === JSON.stringify(srcHist));
  const rstObjects = await objectCounts(DB.RST);
  check('7-schema', 'object counts identical to the source at backup time (tables, columns, constraints, indexes, functions, triggers, enums, sequences, extensions)', JSON.stringify(rstObjects) === JSON.stringify(atBackup1.objects), rstObjects);
  const rstCounts = await withClient(DB.RST, (c) => countAll(c));
  const diff = Object.keys({ ...rstCounts, ...atBackup1.counts }).filter((t) => rstCounts[t] !== atBackup1.counts[t]);
  check('7-schema', 'row counts of every table identical to the source at backup #1', diff.length === 0, { tablesCompared: Object.keys(rstCounts).length, different: diff });

  // 8. functional smoke ------------------------------------------------------------------------------------------------------------------------------
  const smoke = await timed('8-smoke', 'service read paths on the restored copy', async () => {
    const pool = new pg.Pool({ connectionString: url(DB.RST), max: 3 });
    try {
      const db = drizzle(pool, { schema });
      const [{ readBookingConfig }, { listNotices }, { previousProfessionalIds }] = await Promise.all([import('../../api/_services/rdv-booking-config.js'), import('../../api/_services/appointment-notices.js'), import('../../api/_services/rdv-team.js')]);
      const cfg = await readBookingConfig('r45-str-01', db);
      const someAppt = (await pool.query(`SELECT id, "citizenUserId", "structureId" FROM "ProAppointment" WHERE id LIKE 'r45-a-%' AND status = 'done' AND "startAt" < now() ORDER BY id LIMIT 1`)).rows[0];
      const notices = await listNotices(someAppt.id, db);
      const prev = await previousProfessionalIds(someAppt.citizenUserId, someAppt.structureId, db);
      const privacy = createPrivacyRightsService({ db, cryptoLib: crypto });
      const exp = await privacy.getExportData('r45-c-0001');
      const expAppts = (await pool.query(`SELECT count(*)::int n FROM "ProAppointment" WHERE "citizenUserId" = 'r45-c-0001'`)).rows[0].n;
      const erasedBack = (await pool.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [ERASED])).rows[0].n;
      return { configLoaded: Boolean(cfg && typeof cfg === 'object'), notices: notices.length, previousProfessionals: prev.length, exportReturned: Boolean(exp), exportKeys: exp ? Object.keys(exp).length : 0, expectedAppointments: expAppts, erasedPersonBackInOldCopy: erasedBack };
    } finally { await pool.end(); }
  });
  check('8-smoke', 'booking read paths answer on the restored copy (configuration, notices, previous professionals, privacy export)', smoke.configLoaded && smoke.notices >= 1 && smoke.previousProfessionals >= 1 && smoke.exportReturned, smoke);
  check('8-smoke', 'as expected, the OLDER copy holds the person erased after backup #1 again (the reason for the replay)', smoke.erasedPersonBackInOldCopy === 1);

  // 9. replay ----------------------------------------------------------------------------------------------------------------------------------------
  const ledger2 = l2.json.file;
  const replayArgs = ['--ledger', ledger2, '--since-backup', file1, '--confirm-target', host];
  const dry1 = await timed('9-replay', 'replay dry run', () => script('scripts/db-erasure-replay.mjs', replayArgs, { TARGET_DATABASE_URL: url(DB.RST), ...KEYENV() }));
  check('9-replay', 'dry run: 1 erased person present again, 1 withdrawn message present again, the post-backup hold and restriction missing; nothing changed',
    dry1.status === 0 && dry1.json?.presentAgain === 1 && dry1.json.messagesPresentAgain === 1 && dry1.json.holdsMissing === 1 && dry1.json.requestsMissing === 1, dry1.json);
  const ex = await timed('9-replay', 'replay execute (protections, DSR engine, withdrawal)', () => script('scripts/db-erasure-replay.mjs', [...replayArgs, '--execute'], { TARGET_DATABASE_URL: url(DB.RST), DATABASE_URL: url(DB.RST), ...KEYENV() }, { tsx: true }));
  check('9-replay', 'execute: erasure replayed through the DSR engine, message erased, hold and restriction reinstated, 0 failure',
    ex.status === 0 && ex.json?.replayed === 1 && ex.json.failed === 0 && ex.json.messages?.messagesErased === 1 && ex.json.protections?.holdsReinstated === 1 && ex.json.protections?.requestsReinstated === 1, ex.json ?? ex.stderr.slice(0, 300));
  const state = await withClient(DB.RST, async (c) => ({
    erasedAccount: Number((await c.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [ERASED])).rows[0].n),
    erasedLinkedAppointments: Number((await c.query(`SELECT count(*)::int n FROM "ProAppointment" WHERE "citizenUserId" = $1`, [ERASED])).rows[0].n),
    erasedConversations: Number((await c.query(`SELECT count(*)::int n FROM "RdvConversation" WHERE "citizenUserId" = $1`, [ERASED])).rows[0].n),
    erasureRecorded: Number((await c.query(`SELECT count(*)::int n FROM "DSRRequest" WHERE "subjectId" = $1 AND "requestType" = 'DELETE' AND status = 'COMPLETED'`, [ERASED])).rows[0].n),
    message: Number((await c.query(`SELECT count(*)::int n FROM "ProAppointment" WHERE id = $1 AND notes IS NOT NULL`, [after.appointmentId])).rows[0].n),
    withdrawalRecorded: Number((await c.query(`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = $1 AND purpose = 'BOOKING_MESSAGE_TRANSMISSION' AND decision = false`, [WITHDRAWER])).rows[0].n),
    hold: Number((await c.query(`SELECT count(*)::int n FROM "LegalHold" WHERE id = 'r45-lh-after-backup' AND status = 'ACTIVE'`)).rows[0].n),
    restriction: Number((await c.query(`SELECT count(*)::int n FROM "DSRRequest" WHERE id = 'r45-dsr-restrict-after' AND status = 'ACTIVE'`)).rows[0].n),
  }));
  check('9-replay', 'restored copy after replay: erased person absent (account, linked appointments, conversations), erasure re-recorded, message gone, withdrawal re-recorded, hold and restriction ACTIVE',
    state.erasedAccount === 0 && state.erasedLinkedAppointments === 0 && state.erasedConversations === 0 && state.erasureRecorded >= 1 && state.message === 0 && state.withdrawalRecorded >= 1 && state.hold === 1 && state.restriction === 1, state);
  const dry2 = script('scripts/db-erasure-replay.mjs', replayArgs, { TARGET_DATABASE_URL: url(DB.RST), ...KEYENV() });
  check('9-replay', 'second dry run: nothing left to replay (idempotent)', dry2.status === 0 && dry2.json?.presentAgain === 0 && dry2.json.messagesPresentAgain === 0 && dry2.json.holdsMissing === 0 && dry2.json.requestsMissing === 0, dry2.json);

  // 10. purge after restore: the PROPOSED policy is a dry run -------------------------------------------------------------------------------
  const purge = await timed('10-purge', 'gdpr purge after restore (production policy: dry run)', async () => {
    const pool = new pg.Pool({ connectionString: url(DB.RST), max: 3 });
    try {
      const before = await withClient(DB.RST, (c) => countAll(c));
      const { runGdprPurge } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      const out = await runGdprPurge({ database: drizzle(pool, { schema }), env: { GDPR_PURGE_ENABLED: 'true' }, logger: quiet });
      const afterCounts = await withClient(DB.RST, (c) => countAll(c));
      return { status: out.status, mode: out.body.mode, reason: out.body.reason, steps: out.body.steps.length, unchanged: JSON.stringify(before) === JSON.stringify(afterCounts) };
    } finally { await pool.end(); }
  });
  check('10-purge', 'purge on the restored copy with the PROPOSED policy: dry run, every row count unchanged', purge.mode === 'dry-run' && purge.unchanged, purge);

  // 11. failure cases ---------------------------------------------------------------------------------------------------------------------------------
  await emptyDb(DB.FAIL);
  const failHost = `${HOST}/${DB.FAIL}`;
  const restoreInto = (file, extraEnv = {}, extraArgs = []) => script('scripts/db-restore.mjs', ['--file', file, '--confirm-target', failHost, '--work-dir', PRIV, ...extraArgs], { TARGET_DATABASE_URL: url(DB.FAIL), ...KEYENV(), ...extraEnv });
  const buf = fs.readFileSync(file1);
  const corrupt = path.join(BK, 'ada_corrupt_20261105T000001Z.dump.enc'); const b = Buffer.from(buf); b[Math.floor(b.length / 2)] ^= 0x01; fs.writeFileSync(corrupt, b, { mode: 0o600 }); fs.copyFileSync(`${file1}.sha256`, `${corrupt}.sha256`);
  const corruptNoSide = path.join(BK, 'ada_corruptns_20261105T000002Z.dump.enc'); fs.writeFileSync(corruptNoSide, b, { mode: 0o600 });
  const trunc = path.join(BK, 'ada_trunc_20261105T000003Z.dump.enc'); fs.writeFileSync(trunc, buf.subarray(0, Math.floor(buf.length * 0.7)), { mode: 0o600 });
  const { encryptStreamToFile } = await import('../db-backup.mjs');
  const { Readable } = await import('node:stream');
  const notArchive = path.join(BK, 'ada_notarchive_20261105T000004Z.dump.enc');
  await encryptStreamToFile(Readable.from([Buffer.from('SYNTHETIC — NOT A PG_DUMP ARCHIVE')]), notArchive, Buffer.from(keyHex(), 'hex'));
  const cases = [
    ['corrupted file (one bit), sidecar present → SHA-256 refusal', () => restoreInto(corrupt), /empreinte SHA-256/],
    ['corrupted file, no sidecar → GCM tag refusal', () => restoreInto(corruptNoSide), /déchiffrement refusé/],
    ['wrong key → refused', () => restoreInto(file1, { BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') }), /déchiffrement refusé/],
    ['truncated dump (70 %) → refused', () => restoreInto(trunc), /déchiffrement refusé/],
    ['authentic file that is not an archive → refused before the target is touched', () => restoreInto(notArchive), /archive illisible/],
    ['mistyped target → refused', () => script('scripts/db-restore.mjs', ['--file', file1, '--confirm-target', `${HOST}/ada_r45_ops_other_test`, '--work-dir', PRIV], { TARGET_DATABASE_URL: url(DB.FAIL), ...KEYENV() }), /ne correspond pas/],
    ['no key → refused', () => script('scripts/db-restore.mjs', ['--file', file1, '--confirm-target', failHost], { TARGET_DATABASE_URL: url(DB.FAIL) }), /BACKUP_ENCRYPTION_KEY/],
  ];
  for (const [label, fn, re] of cases) {
    const r = await timed('11-failures', label, async () => fn());
    const tables = await publicTables(DB.FAIL);
    check('11-failures', label, r.status === 1 && re.test(r.stderr) && tables === 0 && fs.readdirSync(PRIV).length === 0, { exit: r.status, tablesInTarget: tables, workLeftovers: fs.readdirSync(PRIV).length });
  }
  const nonEmpty = script('scripts/db-restore.mjs', ['--file', file1, '--confirm-target', host, '--work-dir', PRIV], { TARGET_DATABASE_URL: url(DB.RST), ...KEYENV() });
  check('11-failures', 'target not empty → refused (no --into-nonempty)', nonEmpty.status === 1 && /contient déjà/.test(nonEmpty.stderr), { exit: nonEmpty.status });
  const oldLedger = script('scripts/db-erasure-replay.mjs', ['--ledger', l1.json.file, '--since-backup', b2.json.file, '--confirm-target', host], { TARGET_DATABASE_URL: url(DB.RST), ...KEYENV() });
  check('11-failures', 'ledger exported before the restored backup → refused (export the newest ledger)', oldLedger.status === 1 && /before the backup/.test(oldLedger.stderr), { exit: oldLedger.status });
  const wrongLedgerKey = script('scripts/db-erasure-replay.mjs', replayArgs, { TARGET_DATABASE_URL: url(DB.RST), BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') });
  check('11-failures', 'ledger with a wrong key → refused', wrongLedgerKey.status === 1 && /registre illisible/.test(wrongLedgerKey.stderr), { exit: wrongLedgerKey.status });

  // 12. clean-up ---------------------------------------------------------------------------------------------------------------------------------------
  const backupsMade = fs.readdirSync(BK).filter((f) => f.endsWith('.enc')).length;
  if (!keep) await dropAll();
  shred(KEYFILE);
  if (!keep) fs.rmSync(BK, { recursive: true, force: true });
  for (const s of ['upto41', 'upto42']) fs.rmSync(path.join(WORK, s), { recursive: true, force: true });
  const left = await withClient('postgres', async (c) => Number((await c.query(`select count(*)::int n from pg_database where datname = ANY($1)`, [Object.values(DB)])).rows[0].n));
  check('12-cleanup', `databases dropped (${keep ? 'kept: --keep' : 'none left'}), rehearsal key shredded, ${backupsMade} encrypted rehearsal files removed`, (keep || left === 0) && !fs.existsSync(KEYFILE) && (keep || !fs.existsSync(BK)));

  const rto = timings.filter((t) => ['6-restore', '7-schema', '8-smoke', '9-replay'].includes(t.step)).reduce((a, t) => a + t.ms, 0);
  const report = { kind: 'r45-restore-rehearsal', synthetic: true, production: false, startedAt, finishedAt: new Date().toISOString(), cluster: 'local PostgreSQL 17 (127.0.0.1:55434)',
    sizes: { archiveBytes: b1.json?.archiveBytes, encryptedBytes: b1.json?.encryptedBytes }, seeded: Object.fromEntries(Object.entries(seeded).filter(([, v]) => v > 0)),
    objects: atBackup1.objects, timings, rtoCoreMs: rto, checks, commands, ok: checks.every((c) => c.ok) };
  fs.writeFileSync(path.join(OUT, 'restore-rehearsal.json'), JSON.stringify(report, null, 1));
  console.log(`REHEARSAL ${JSON.stringify({ ok: report.ok, checks: checks.length, failed: checks.filter((c) => !c.ok).length, rtoCoreMs: rto })}`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch(async (e) => {
  console.error(`REHEARSAL {"ok":false,"reason":"unexpected","message":${JSON.stringify(String(e?.message || e).slice(0, 300))}}`);
  try { shred(KEYFILE); if (!keep) await dropAll(); } catch { /* best effort */ }
  process.exitCode = 2;
});
