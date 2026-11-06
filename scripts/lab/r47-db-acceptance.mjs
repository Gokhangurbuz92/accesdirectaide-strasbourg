#!/usr/bin/env node
/**
 * R47 audit — database acceptance on DISPOSABLE LAB databases (127.0.0.1:55434, names « ada_r47_audit_db_*_test »). Synthetic rows only
 * (scripts/lab/r45-synthetic-seed.mjs); never a URL, secret or value printed; nothing reaches Production.
 *
 *   node --import tsx scripts/lab/r47-db-acceptance.mjs --out <evidence dir> --work <scratch dir> [--dist <built app dir>] [--skip-browser] [--keep]
 *
 *   P  a database at the Production shape 0042 (stock migrate of 0000..0041 then 0000..0042, 43 history rows) + the synthetic seed.
 *   d  GDPR purge: every run that lacks ONE of the four execution conditions (operator switch, approved policy, pinned version, approved steps — the
 *      step approved both in GDPR_PURGE_APPROVED_STEPS and in the policy record) and the explicit dry-run request is a DRY RUN that reports a numeric count
 *      per executable step and writes NOTHING (row counts of every public table, pg_stat tuple counters, no GDPR_PURGE_RUN audit row). Positive control
 *      on a clone: with the four conditions met the same measurement sees the writes (the measurement is able to fail).
 *   a  the Production command on a clone of P: --only 0045 applies exactly 0045; afterwards --only 0043 / --only 0044 are still refused, the plain plan
 *      is empty, --check reports no journal / history / schema drift; a second --only 0045 is ALREADY_APPLIED.
 *   b  drizzle/rollback/0045_down.sql restores the 0042 shape: schema dump identical to P's, 43 identical history rows.
 *   e  a release-acceptance style read-only session (the release smoke of scripts/release-production.sh + scripts/acceptance/r31-prod-accept.mjs, the
 *      anonymous public-route acceptance) against the BUILT app + real API (scripts/lab-server.mjs on :5194, veille and network off) on a clone of P:
 *      pg_stat_database / pg_stat_user_tables tuple counters and every table's row count before and after — zero writes expected.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { seedRealistic, countAll } from './r45-synthetic-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIG = path.join(ROOT, 'drizzle');
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
if (!arg('--out') || !arg('--work')) { console.error('R47_DB_ACCEPTANCE {"ok":false,"reason":"--out and --work are required"}'); process.exit(3); }
const OUT = path.resolve(String(arg('--out'))); const WORK = path.resolve(String(arg('--work')));
const DIST = path.resolve(String(arg('--dist', path.join(ROOT, 'dist'))));
const keep = process.argv.includes('--keep'); const skipBrowser = process.argv.includes('--skip-browser');
const PGBIN = '/opt/homebrew/opt/postgresql@17/bin';
const PORT = 5194;
const DB = { P: 'ada_r47_audit_db_p_test', X: 'ada_r47_audit_db_exec_test', M: 'ada_r47_audit_db_mig_test', E: 'ada_r47_audit_db_accept_test' };
for (const n of Object.values(DB)) if (!/^ada_r47_audit_db_[a-z0-9_]+_test$/.test(n)) process.exit(3);
const url = (db) => `postgresql://ada_test@127.0.0.1:55434/${db}`;
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
const SECRETS = Object.fromEntries(['JWT_SECRET', 'AUTH_SECRET', 'ADA_ENCRYPTION_KEY', 'CRON_SECRET', 'ADMIN_TOKEN'].map((k) => [k, crypto.randomBytes(32).toString('hex')]));
Object.assign(process.env, SECRETS, { DATABASE_URL: url(DB.P), NODE_ENV: 'test', VERCEL_ENV: 'development', ADA_PUBLIC_CONTENT_MODE: 'lab', LOG_LEVEL: 'silent' });

const checks = [];
const check = (step, label, ok, detail) => { const d = detail === undefined ? undefined : JSON.stringify(detail); checks.push({ step, label, ok: Boolean(ok), ...(d ? { detail: d.slice(0, 3000) } : {}) }); console.log(`${ok ? 'PASS' : 'FAIL'} [${step}] ${label}${d ? ` — ${d.slice(0, 300)}` : ''}`); };
async function withClient(db, fn) { const c = new pg.Client({ connectionString: url(db) }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const admin = (sqls) => withClient('postgres', async (c) => { for (const s of sqls) await c.query(s); });
const dropAll = () => admin(Object.values(DB).map((d) => `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`));
const clone = (src, db) => admin([`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, `CREATE DATABASE ${db} TEMPLATE ${src}`, `ALTER DATABASE ${db} SET timezone TO 'UTC'`]);
const journal = JSON.parse(fs.readFileSync(path.join(MIG, 'meta', '_journal.json'), 'utf8'));
const stage = (name, maxIdx) => {
  const d = path.join(WORK, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(path.join(d, 'meta'), { recursive: true });
  const entries = journal.entries.filter((e) => e.idx <= maxIdx);
  for (const e of entries) fs.copyFileSync(path.join(MIG, `${e.tag}.sql`), path.join(d, `${e.tag}.sql`));
  fs.writeFileSync(path.join(d, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return d;
};
const schemaDump = (db) => execFileSync(path.join(PGBIN, 'pg_dump'), ['-h', '127.0.0.1', '-p', '55434', '-U', 'ada_test', '--schema-only', '--no-owner', '--no-privileges', '-d', db], { encoding: 'utf8' })
  .split('\n').filter((l) => !/^-- (Dumped|Started|Completed)/.test(l) && !/^\\(un)?restrict /.test(l)).join('\n');
const history = (db) => withClient(db, async (c) => (await c.query('select id, hash, created_at::text from drizzle.__drizzle_migrations order by id')).rows);
/** tuple counters of the database and of every user table (flushed: the measuring session clears its snapshot; callers wait for other backends to end) */
const stats = (db) => withClient(db, async (c) => {
  await c.query('select pg_stat_clear_snapshot()');
  const d = (await c.query('select xact_commit::bigint::text xc, tup_inserted::bigint::text ins, tup_updated::bigint::text upd, tup_deleted::bigint::text del from pg_stat_database where datname = current_database()')).rows[0];
  const t = (await c.query('select relname, (n_tup_ins + n_tup_upd + n_tup_del)::bigint::text w from pg_stat_user_tables')).rows;
  return { xactCommit: Number(d.xc), inserted: Number(d.ins), updated: Number(d.upd), deleted: Number(d.del), tables: Object.fromEntries(t.map((r) => [r.relname, Number(r.w)])) };
});
/** the counters once every other backend's pending statistics are flushed (two equal readings 700 ms apart; at most ~15 s) */
const settled = async (db) => {
  let a = await stats(db);
  for (let i = 0; i < 20; i += 1) { await sleep(700); const b = await stats(db); if (b.inserted === a.inserted && b.updated === a.updated && b.deleted === a.deleted) return b; a = b; }
  return a;
};
const writesBetween = (a, b) => ({ inserted: b.inserted - a.inserted, updated: b.updated - a.updated, deleted: b.deleted - a.deleted,
  tables: Object.fromEntries(Object.keys(b.tables).map((k) => [k, b.tables[k] - (a.tables[k] || 0)]).filter(([, v]) => v !== 0)), xactCommit: b.xactCommit - a.xactCommit });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (db, args) => {
  const r = spawnSync(process.execPath, ['scripts/db-deploy-migrate.mjs', '--lab-rehearsal', ...args], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL_UNPOOLED: url(db) } });
  const lines = `${r.stdout}\n${r.stderr}`.split('\n');
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, line: (tag) => { const l = lines.find((x) => x.startsWith(`${tag} `)); try { return l ? JSON.parse(l.slice(tag.length + 1)) : null; } catch { return null; } } };
};
const T43 = '0043_r38_guest_booking'; const T44 = '0044_r39_guest_reminder_consent'; const T45 = '0045_r43_appointment_notice_kinds';

async function main() {
  const startedAt = new Date().toISOString();
  await dropAll();
  // P: Production shape 0042 + synthetic seed ------------------------------------------------------------------------------------------------------
  await admin([`CREATE DATABASE ${DB.P} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`, `ALTER DATABASE ${DB.P} SET timezone TO 'UTC'`]);
  await withClient(DB.P, async (c) => { for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`); });
  for (const [n, i] of [['p41', 41], ['p42', 42]]) { const pool = new pg.Pool({ connectionString: url(DB.P), max: 2 }); try { await migrate(drizzle(pool), { migrationsFolder: stage(n, i) }); } finally { await pool.end(); } }
  const h42 = await history(DB.P);
  const guest0 = await withClient(DB.P, async (c) => Number((await c.query(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='ProAppointment' and column_name like 'guest%'`)).rows[0].n));
  check('P', 'database at 0042: 43 history rows, last created_at = 0042 « when », no guest column', h42.length === 43 && h42[42].created_at === String(journal.entries[42].when) && guest0 === 0, { rows: h42.length });
  await withClient(DB.P, (c) => seedRealistic(c));
  const schema42 = schemaDump(DB.P);
  const seeded = await withClient(DB.P, (c) => countAll(c));

  // d. GDPR purge without the four conditions -------------------------------------------------------------------------------------------------------
  const schema = await import('../../src/db/schema.js');
  const { runGdprPurge, PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
  const { RETENTION_POLICY } = await import('../../api/_services/retention-policy.js');
  const { approvedTestPolicy, approvalEnv, executableStepIds } = await import('../../tests/helpers/gdpr-purge-approval.js');
  const all = executableStepIds(PURGE_STEPS);
  const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const runOn = async (db, opts) => { const pool = new pg.Pool({ connectionString: url(db), max: 3 }); try { return await runGdprPurge({ database: drizzle(pool, { schema }), logger: quiet, ...opts }); } finally { await pool.end(); } };
  const now = new Date();
  const okEnv = approvalEnv(all);
  const without = (k) => Object.fromEntries(Object.entries(okEnv).filter(([x]) => x !== k));
  const COMBOS = [
    { label: 'nothing set (Production today)', policy: RETENTION_POLICY, env: {}, reason: 'GDPR_PURGE_DISABLED' },
    { label: 'condition 1 missing: GDPR_PURGE_ENABLED unset (approved test policy, pinned version, every step approved)', policy: approvedTestPolicy(), env: without('GDPR_PURGE_ENABLED'), reason: 'GDPR_PURGE_DISABLED' },
    { label: 'condition 2 missing: the real policy (PROPOSED — NOT APPROVED) with every variable set', policy: RETENTION_POLICY, env: { ...okEnv, GDPR_PURGE_POLICY_VERSION: RETENTION_POLICY.version }, reason: 'POLICY_NOT_APPROVED' },
    { label: 'condition 3 missing: version not pinned (GDPR_PURGE_POLICY_VERSION unset)', policy: approvedTestPolicy(), env: without('GDPR_PURGE_POLICY_VERSION'), reason: 'POLICY_VERSION_NOT_PINNED' },
    { label: 'condition 3 missing: another version pinned', policy: approvedTestPolicy(), env: { ...okEnv, GDPR_PURGE_POLICY_VERSION: `${okEnv.GDPR_PURGE_POLICY_VERSION}-other` }, reason: 'POLICY_VERSION_NOT_PINNED' },
    { label: 'condition 4 missing: no step listed in GDPR_PURGE_APPROVED_STEPS', policy: approvedTestPolicy(), env: without('GDPR_PURGE_APPROVED_STEPS'), reason: 'NO_APPROVED_STEPS' },
    { label: 'condition 4 missing: steps listed but no step approval in the policy record', policy: approvedTestPolicy({ steps: [] }), env: okEnv, reason: null, perStep: true },
    { label: 'all four met but ?dryRun=1 requested', policy: approvedTestPolicy(), env: okEnv, reason: 'DRY_RUN_REQUESTED', dryRunRequested: true },
  ];
  const purgeEvidence = [];
  for (const k of COMBOS) {
    const evN = () => withClient(DB.P, async (c) => Number((await c.query(`select count(*)::int n from "AuditLog" where action = 'GDPR_PURGE_RUN'`)).rows[0].n));
    const ev0 = await evN();
    const b = await withClient(DB.P, (c) => countAll(c)); const s0 = await settled(DB.P);
    const r = await runOn(DB.P, { now, policy: k.policy, env: k.env, dryRunRequested: k.dryRunRequested === true });
    const s1 = await settled(DB.P); const a = await withClient(DB.P, (c) => countAll(c)); const w = writesBetween(s0, s1);
    const steps = r.body.steps || [];
    const execSteps = steps.filter((s) => all.includes(s.id));
    const schemaSkipped = execSteps.filter((s) => s.decision === 'skipped_schema').map((s) => s.id);
    const numeric = execSteps.filter((s) => typeof s.count === 'number' || (s.countsByOption && Object.keys(s.countsByOption).length && Object.values(s.countsByOption).every((v) => typeof v === 'number')));
    const executed = steps.filter((s) => s.decision === 'executed').map((s) => s.id);
    const evidence = (await evN()) - ev0;
    // a run whose gate passed but whose steps all lack their approval record leaves its accountability row (GDPR_PURGE_RUN: nothing executed, the refused
    // steps named) and changes nothing else; every other combination writes nothing at all
    const lastEv = k.perStep ? await withClient(DB.P, async (c) => (await c.query(`select details from "AuditLog" where action = 'GDPR_PURGE_RUN' order by timestamp desc limit 1`)).rows[0]?.details) : null;
    const expectedEvidence = k.perStep ? 1 : 0;
    const otherTables = Object.keys(w.tables).filter((t) => !(k.perStep && t === 'AuditLog'));
    const countsSame = Object.keys(b).every((t) => a[t] === b[t] + (k.perStep && t === 'AuditLog' ? 1 : 0));
    // the gate passed but no step carries its own approval record: the run is « execute » mode and every step is refused one by one (not_approved_in_policy)
    const modeOk = k.perStep ? execSteps.filter((s) => s.decision !== 'skipped_schema').every((s) => s.decision === 'not_approved_in_policy') : r.body.mode === 'dry-run';
    const ok = modeOk && (k.reason ? r.body.reason === k.reason : true) && executed.length === 0 && numeric.length + schemaSkipped.length === execSteps.length && execSteps.length === all.length
      && countsSame && w.inserted === expectedEvidence && w.updated === 0 && w.deleted === 0 && otherTables.length === 0 && evidence === expectedEvidence
      && (!k.perStep || (lastEv && Object.keys(lastEv.executed || {}).length === 0 && (lastEv.stepApprovalMissing || []).length > 0));
    check('d-purge', `${k.label}: ${k.perStep ? 'every step refused by its missing approval' : 'dry run'}, ${numeric.length} per-step counts (+${schemaSkipped.length} skipped: table/column absent at 0042), nothing executed, ${k.perStep ? 'only its GDPR_PURGE_RUN accountability row written (executed: none)' : '0 rows written'}`, ok,
      { mode: r.body.mode, reason: r.body.reason, executed, counted: numeric.length, skippedSchema: schemaSkipped, writes: { ins: w.inserted, upd: w.updated, del: w.deleted, tables: w.tables }, auditEvidenceRows: evidence, ...(lastEv ? { evidenceExecuted: lastEv.executed, evidenceRefusedSteps: (lastEv.stepApprovalMissing || []).length } : {}) });
    purgeEvidence.push({ combo: k.label, mode: r.body.mode, reason: r.body.reason ?? null, perStep: steps.map((s) => ({ id: s.id, decision: s.decision, count: s.count ?? null, countsByOption: s.countsByOption ?? null })), writes: w });
  }
  // positive control: the four conditions met on a clone → executed, and the same measurement sees it
  await clone(DB.P, DB.X);
  const sx0 = await settled(DB.X); const bx = await withClient(DB.X, (c) => countAll(c));
  const rx = await runOn(DB.X, { now, policy: approvedTestPolicy(), env: okEnv });
  const sx1 = await settled(DB.X); const ax = await withClient(DB.X, (c) => countAll(c)); const wx = writesBetween(sx0, sx1);
  const executedX = (rx.body.steps || []).filter((s) => s.decision === 'executed' && (s.count || 0) > 0).map((s) => s.id);
  check('d-purge', 'positive control (clone, four conditions met, test copy of the policy): executes, and the measurement sees the writes and the evidence row',
    rx.body.mode !== 'dry-run' && executedX.length > 0 && (wx.inserted + wx.updated + wx.deleted) > 0 && JSON.stringify(ax) !== JSON.stringify(bx) && rx.body.audit_evidence === 'written',
    { mode: rx.body.mode, executedWithRows: executedX.length, writes: { ins: wx.inserted, upd: wx.updated, del: wx.deleted } });

  // a / b. the Production command on a clone of P -------------------------------------------------------------------------------------------------------
  await clone(DB.P, DB.M);
  let r = cli(DB.M, ['--check']);
  check('a-0045', '--check on the 0042 clone: clean, plain plan refused OBSOLETE_MIGRATION_PENDING [0043, 0044, 0045]', r.status === 0 && r.line('DB_DEPLOY_MIGRATE_PREFLIGHT')?.plainPlan?.reason === 'OBSOLETE_MIGRATION_PENDING', r.line('DB_DEPLOY_MIGRATE_PREFLIGHT')?.plainPlan);
  r = cli(DB.M, ['--only', T45, '--dry-run']);
  check('a-0045', '--only 0045 --dry-run: plan [0045], nothing written', r.status === 0 && JSON.stringify(r.line('DB_DEPLOY_MIGRATE_ONLY')?.apply) === JSON.stringify([T45]) && (await history(DB.M)).length === 43);
  r = cli(DB.M, ['--only', T45]);
  const h45 = await history(DB.M);
  check('a-0045', '--only 0045 applies exactly 0045 (44 rows, the new row = sha256 of the file, created_at = its « when »)', r.status === 0 && r.line('DB_DEPLOY_MIGRATE_ONLY')?.applied === T45 && h45.length === 44
    && h45[43].hash === crypto.createHash('sha256').update(fs.readFileSync(path.join(MIG, `${T45}.sql`))).digest('hex') && h45[43].created_at === String(journal.entries[45].when));
  for (const t of [T43, T44]) {
    r = cli(DB.M, ['--only', t]);
    check('a-0045', `after 0045, --only ${t} is still refused (OBSOLETE_MIGRATION_REFUSED), history unchanged`, r.status === 3 && r.line('DB_DEPLOY_MIGRATE_ONLY')?.reason === 'OBSOLETE_MIGRATION_REFUSED' && (await history(DB.M)).length === 44, r.line('DB_DEPLOY_MIGRATE_ONLY'));
  }
  r = cli(DB.M, ['--check']); const pf = r.line('DB_DEPLOY_MIGRATE_PREFLIGHT');
  check('a-0045', '--check after 0045: exit 0, journal OK, history OK (last applied 0045), schema drift: 0 findings, plain plan empty', r.status === 0 && pf?.journal?.ok && pf?.history?.ok && pf?.history?.lastApplied === T45
    && Array.isArray(pf?.drift?.findings) && pf.drift.findings.length === 0 && pf?.plainPlan?.ok === true && pf.plainPlan.apply.length === 0, { history: pf?.history, drift: pf?.drift?.findings, plan: pf?.plainPlan });
  r = cli(DB.M, ['--only', T45]);
  check('a-0045', 'idempotent: a second --only 0045 is ALREADY_APPLIED, 44 rows', r.line('DB_DEPLOY_MIGRATE_ONLY')?.reason === 'ALREADY_APPLIED' && (await history(DB.M)).length === 44);
  r = cli(DB.M, []);
  check('a-0045', 'idempotent: the plain run applies nothing (no 0043 / 0044: behind the newest row)', r.status === 0 && r.out.includes('DB_DEPLOY_MIGRATE_APPLIED []') && (await history(DB.M)).length === 44);
  const guest45 = await withClient(DB.M, async (c) => Number((await c.query(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='ProAppointment' and column_name like 'guest%'`)).rows[0].n));
  check('a-0045', 'no 0043 / 0044 object exists after the targeted path (no guest column)', guest45 === 0);
  const rb = spawnSync(path.join(PGBIN, 'psql'), ['-h', '127.0.0.1', '-p', '55434', '-U', 'ada_test', '-d', DB.M, '-1', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(MIG, 'rollback', '0045_down.sql')], { encoding: 'utf8' });
  const hRb = await history(DB.M);
  check('b-down', '0045_down.sql restores the 0042 shape: schema dump identical to the 0042 database, 43 identical history rows', rb.status === 0 && schemaDump(DB.M) === schema42 && JSON.stringify(hRb.map((x) => [x.hash, x.created_at])) === JSON.stringify(h42.map((x) => [x.hash, x.created_at])), { psql: rb.status, rows: hRb.length });
  r = cli(DB.M, ['--check']);
  check('b-down', 'after the rollback the guard is back to the 0042 state (plain plan OBSOLETE_MIGRATION_PENDING, no drift)', r.status === 0 && r.line('DB_DEPLOY_MIGRATE_PREFLIGHT')?.plainPlan?.reason === 'OBSOLETE_MIGRATION_PENDING' && r.line('DB_DEPLOY_MIGRATE_PREFLIGHT')?.drift?.findings?.length === 0);

  // e. read-only acceptance session writes nothing ------------------------------------------------------------------------------------------------------
  let accept = null;
  if (!skipBrowser) {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('no build (--dist)');
    await clone(DB.P, DB.E);
    const c0 = await withClient(DB.E, (c) => countAll(c)); const e0 = await settled(DB.E);
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC', NODE_ENV: 'development', VERCEL_ENV: '', ADA_PUBLIC_CONTENT_MODE: 'lab', LAB_PORT: String(PORT), LAB_DIST: DIST,
      DATABASE_URL: url(DB.E), ...SECRETS, OLLAMA_BASE_URL: 'http://127.0.0.1:9', ADA_VEILLE: 'off', ADA_VERIFICATION_NETWORK: 'off' };
    const log = fs.openSync(path.join(WORK, 'accept-server.log'), 'w');
    const srv = spawn(process.execPath, ['--import', 'tsx', 'scripts/lab-server.mjs'], { cwd: ROOT, env, stdio: ['ignore', log, log] });
    const base = `http://127.0.0.1:${PORT}`;
    let up = false; for (let i = 0; i < 90 && !up; i += 1) { try { up = (await fetch(`${base}/__lab/health`)).ok; } catch { await sleep(1000); } }
    if (!up) { srv.kill('SIGTERM'); throw new Error('LAB server did not start'); }
    await sleep(3000);
    const eStart = await settled(DB.E); const startupWrites = writesBetween(e0, eStart);
    // the release smoke (scripts/release-production.sh smoke()): health + release header, readiness, one public list, the home page
    const smoke = {};
    for (const [k, p] of [['health', '/api/health'], ['ready', '/api/health/ready'], ['aides', '/api/aides?pageSize=1'], ['home', '/']]) {
      try { const res = await fetch(base + p); smoke[k] = { status: res.status, releaseHeader: res.headers.has('x-release-sha') }; await res.arrayBuffer(); } catch (e) { smoke[k] = { error: String(e?.message || e).slice(0, 80) }; }
    }
    const res = spawnSync(process.execPath, ['scripts/acceptance/r31-prod-accept.mjs', base, path.join(OUT, 'accept-r31.json')], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, PW_CHANNEL: 'chrome' }, timeout: 1_500_000 });
    const summaryLine = String(res.stdout).split('\n').find((l) => l.startsWith('R31_PROD_ACCEPT '));
    fs.writeFileSync(path.join(OUT, 'accept-r31-stdout.txt'), String(res.stdout));
    srv.kill('SIGTERM'); await new Promise((r2) => srv.once('exit', r2)); const e1 = await settled(DB.E); const c1 = await withClient(DB.E, (c) => countAll(c));
    const sessionWrites = writesBetween(eStart, e1); const total = writesBetween(e0, e1);
    accept = { smoke, r31: summaryLine ? JSON.parse(summaryLine.slice('R31_PROD_ACCEPT '.length)) : { exit: res.status }, startupWrites, sessionWrites, total };
    check('e-readonly', 'the release smoke answered (health 200, readiness, public list, home 200)', smoke.health?.status === 200 && smoke.home?.status === 200, smoke);
    // the acceptance's own findings, classified: on this LAB (no beta flag, port 5194 outside the API's development origin allowlist) an anonymous page probes
    // the session (401 /api/auth/me) and the search POSTs are refused by the origin gate (403) — harness conditions, not a write path
    const lines = String(res.stdout).split('\n').filter((l) => l.startsWith('ISSUE ') || l.startsWith('OK '));
    const other = lines.filter((l) => l.startsWith('ISSUE ')).map((l) => l.replace(/^.* — /, '').replace(/(, )?401 \/api\/auth\/me/g, '').replace(/(, )?403 \/api\/search(-pro)?/g, '').replace(/^failed requests:\s*$/, '').trim()).filter(Boolean);
    accept.r31.otherIssues = other;
    check('e-readonly', `the anonymous public acceptance ran (${accept.r31.pages ?? '?'} page visits; issues other than the LAB session probe / origin refusal: ${other.length})`, (accept.r31.pages || 0) >= 60, { pages: accept.r31.pages, issues: accept.r31.issues, otherIssues: other.slice(0, 10), skipped: accept.r31.skipped });
    check('e-readonly', 'read-only session: pg_stat_database tuples inserted / updated / deleted = 0, no table written, every row count unchanged (xact_commit grows with reads only)',
      sessionWrites.inserted === 0 && sessionWrites.updated === 0 && sessionWrites.deleted === 0 && Object.keys(sessionWrites.tables).length === 0 && JSON.stringify(c0) === JSON.stringify(c1),
      { xactCommitDelta: sessionWrites.xactCommit, writes: { ins: sessionWrites.inserted, upd: sessionWrites.updated, del: sessionWrites.deleted, tables: sessionWrites.tables },
        changedCounts: Object.keys(c1).filter((k) => c1[k] !== c0[k]) });
    check('e-readonly', 'server start + idle wrote nothing either', startupWrites.inserted + startupWrites.updated + startupWrites.deleted === 0, { tables: startupWrites.tables });
  }

  if (!keep) await dropAll();
  for (const s of ['p41', 'p42']) fs.rmSync(path.join(WORK, s), { recursive: true, force: true });
  const left = await withClient('postgres', async (c) => Number((await c.query(`select count(*)::int n from pg_database where datname = ANY($1)`, [Object.values(DB)])).rows[0].n));
  check('cleanup', 'disposable databases dropped', keep || left === 0);
  const report = { kind: 'r47-db-acceptance', synthetic: true, production: false, startedAt, finishedAt: new Date().toISOString(), policyVersion: RETENTION_POLICY.version, policyStatus: RETENTION_POLICY.status,
    seeded: Object.fromEntries(Object.entries(seeded).filter(([, v]) => v > 0)), purge: purgeEvidence, accept, checks, ok: checks.every((x) => x.ok) };
  fs.writeFileSync(path.join(OUT, 'r47-db-acceptance.json'), JSON.stringify(report, null, 1));
  console.log(`R47_DB_ACCEPTANCE ${JSON.stringify({ ok: report.ok, checks: checks.length, failed: checks.filter((x) => !x.ok).length })}`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch(async (e) => { console.error(`R47_DB_ACCEPTANCE {"ok":false,"message":${JSON.stringify(String(e?.message || e).slice(0, 300))}}`); try { if (!keep) await dropAll(); } catch { /* best effort */ } process.exitCode = 2; });
