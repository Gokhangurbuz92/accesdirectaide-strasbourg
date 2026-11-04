#!/usr/bin/env node
/**
 * R44 — LAB rehearsal of the migration-safety guard and of the one-time Production procedure for 0045, on disposable databases of the local LAB cluster
 * (127.0.0.1:55434, trust auth, names « ada_r44_migrate_*_test »). Synthetic rows only; no URL or secret is printed.
 *
 *   node scripts/lab/r44-migration-safety-rehearsal.mjs --out <evidence dir> --work <scratch dir> [--pg-bin <dir>] [--keep]
 *
 * Databases: P = Production shape (stock drizzle migrate() of 0000..0041, then of 0000..0042 — the two runs Production had: 43 history rows, ids 1..43,
 * sha256 hashes, created_at = journal « when »); F = the LAB full chain (0000..0045); clones and a restore target. Steps (each check PASS/FAIL, JSON out):
 *   0 shapes; 1 guard preflight; 2 stock drizzle semantics (what a plain migrate() / drizzle-kit migrate would do); 3 backup; 4 targeted 0045 through the CLI;
 *   5 idempotence; 6 stock migrate after 0045; 7 rollback; 8 reapply; 9 restore; 10 a simulated future 0046 (CLI and stock); 11 drift detection (negative
 *   cases); 12 the LAB full chain.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { applyOnly, applyPending } from '../db-deploy-migrate.mjs';
import { loadMigrations, preflight, sha256, stockMigrateRefusal } from '../db-migrate-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIG = path.join(ROOT, 'drizzle');
const T45 = '0045_r43_appointment_notice_kinds';
const T43 = '0043_r38_guest_booking';
const T44 = '0044_r39_guest_reminder_consent';
const T46 = '0046_r44_rehearsal_probe';
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const OUT = path.resolve(String(arg('--out', '')));
const WORK = path.resolve(String(arg('--work', '')));
const PGBIN = String(arg('--pg-bin', '/opt/homebrew/opt/postgresql@17/bin'));
const keep = process.argv.includes('--keep');
const HOST = '127.0.0.1'; const PORT = '55434'; const USER = 'ada_test';
if (!arg('--out') || !arg('--work')) { console.error('REHEARSAL {"ok":false,"reason":"--out and --work are required"}'); process.exit(3); }
const DB = {
  P: 'ada_r44_migrate_prod_test', F: 'ada_r44_migrate_full_test', R: 'ada_r44_migrate_restore_test', S: 'ada_r44_migrate_stock_test',
  N: 'ada_r44_migrate_neg_test', X: 'ada_r44_migrate_stock46_test',
};
for (const n of Object.values(DB)) if (!/^ada_r44_migrate_[a-z0-9_]+_test$/.test(n)) process.exit(3);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });

const url = (db) => `postgresql://${USER}@${HOST}:${PORT}/${db}`;
const tool = (t, args) => execFileSync(path.join(PGBIN, t), ['-h', HOST, '-p', PORT, '-U', USER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const checks = [];
const log = [];
const check = (step, label, ok, detail) => {
  const d = detail === undefined ? undefined : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  checks.push({ step, label, ok: Boolean(ok), ...(d ? { detail: d.slice(0, 2000) } : {}) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${step}] ${label}${d ? ` — ${d.slice(0, 300)}` : ''}`);
};
const note = (cmd, output) => { log.push({ cmd, output: String(output).slice(0, 4000) }); };
async function withClient(db, fn) { const c = new pg.Client({ connectionString: url(db) }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
async function admin(sqls) { await withClient('postgres', async (c) => { for (const s of sqls) await c.query(s); }); }
const fresh = async (db) => {
  await admin([`DROP DATABASE IF EXISTS ${db}`, `CREATE DATABASE ${db} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`, `ALTER DATABASE ${db} SET timezone TO 'UTC'`]);
  await withClient(db, async (c) => { for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`); });
};
const cloneOf = async (src, db) => admin([`DROP DATABASE IF EXISTS ${db}`, `CREATE DATABASE ${db} TEMPLATE ${src}`, `ALTER DATABASE ${db} SET timezone TO 'UTC'`]);
const stockMigrate = async (db, folder) => { const pool = new pg.Pool({ connectionString: url(db), max: 2 }); try { await migrate(drizzle(pool), { migrationsFolder: folder }); } finally { await pool.end(); } };
const journalAll = JSON.parse(fs.readFileSync(path.join(MIG, 'meta', '_journal.json'), 'utf8'));
const stage = (name, filter, extra = []) => {
  const d = path.join(WORK, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(path.join(d, 'meta'), { recursive: true });
  const entries = journalAll.entries.filter(filter).map((e) => ({ ...e }));
  for (const e of entries) fs.copyFileSync(path.join(MIG, `${e.tag}.sql`), path.join(d, `${e.tag}.sql`));
  for (const x of extra) { entries.push(x.entry); fs.writeFileSync(path.join(d, `${x.entry.tag}.sql`), x.sql); }
  fs.writeFileSync(path.join(d, 'meta', '_journal.json'), JSON.stringify({ ...journalAll, entries }, null, 2));
  return d;
};
const history = (c) => c.query('select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id').then((r) => r.rows);
const kindDef = async (c) => (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'AppointmentNotice_kind_check'`)).rows[0]?.d || '';
const guestCols = async (c) => Number((await c.query(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'ProAppointment' and column_name like 'guest%'`)).rows[0].n);
const schemaDump = (db) => tool('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '-d', db]).split('\n').filter((l) => !/^-- (Dumped|Started|Completed)/.test(l) && !/^\\(un)?restrict /.test(l)).join('\n');
const cli = (db, args, folder = null) => {
  const argv = ['scripts/db-deploy-migrate.mjs', '--lab-rehearsal', ...args, ...(folder ? ['--migrations', folder] : [])];
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL_UNPOOLED: url(db) } });
  const output = `${r.stdout}${r.stderr}`.trim();
  note(`DATABASE_URL_UNPOOLED=<${db}> node ${argv.map((a) => (a === folder ? '<staged folder>' : a)).join(' ')}   # exit ${r.status}`, output);
  const line = (prefix) => { const l = output.split('\n').find((x) => x.startsWith(prefix + ' ')); return l ? JSON.parse(l.slice(prefix.length + 1)) : null; };
  return { status: r.status, output, line };
};
const BOOK4 = ['BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED'];
const SQL46 = [
  '-- R44 rehearsal only (never committed to drizzle/): a future additive, idempotent migration after 0045.',
  'CREATE TABLE IF NOT EXISTS "R44RehearsalProbe" (\n\t"id" text PRIMARY KEY NOT NULL,\n\t"createdAt" timestamp (3) DEFAULT now() NOT NULL\n);',
  '--> statement-breakpoint',
  'CREATE INDEX IF NOT EXISTS "R44RehearsalProbe_createdAt_idx" ON "R44RehearsalProbe" USING btree ("createdAt");',
].join('\n');
const e45 = journalAll.entries.find((e) => e.tag === T45);
const ENTRY46 = { idx: 46, version: e45.version, when: e45.when + 86_400_000, tag: T46, breakpoints: true };

async function main() {
  const files = loadMigrations(MIG).files;
  // 0. shapes ------------------------------------------------------------------------------------------------------------------------------------
  await fresh(DB.P);
  await stockMigrate(DB.P, stage('upto41', (e) => e.idx <= 41));   // Production: 0000..0041 (public beta, 29/10)
  await stockMigrate(DB.P, stage('upto42', (e) => e.idx <= 42));   // Production: 0042 (R31, 01/11)
  await fresh(DB.F); await stockMigrate(DB.F, MIG);
  const p0 = await withClient(DB.P, async (c) => ({ rows: await history(c), def: await kindDef(c), guest: await guestCols(c),
    tables: Number((await c.query(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n) }));
  const prodLike = p0.rows.length === 43 && p0.rows.every((r, i) => r.id === i + 1 && r.hash === files[journalAll.entries[i].tag].hash && Number(r.created_at) === journalAll.entries[i].when);
  check('0-shape', 'P = Production shape: 43 history rows, ids 1..43, hash = sha256(file), created_at = « when » of 0000..0042, last 1793460973811', prodLike && p0.rows[42].created_at === '1793460973811', { rows: p0.rows.length, last: p0.rows.at(-1) });
  check('0-shape', 'P: 108 public tables (Production after 0042: publicTables 108), no guest column, kind CHECK = the seven 0020 kinds', p0.tables === 108 && p0.guest === 0 && !p0.def.includes('BOOKED_BY_GUEST') && !p0.def.includes('REQUEST_RECEIVED'), { tables: p0.tables, def: p0.def });
  fs.writeFileSync(path.join(OUT, 'p-history-0042.json'), JSON.stringify(p0.rows, null, 1));

  // 1. guard preflight on P ----------------------------------------------------------------------------------------------------------------------
  let r = cli(DB.P, ['--check']);
  let pre = r.line('DB_DEPLOY_MIGRATE_PREFLIGHT');
  check('1-preflight', '--check on P: journal OK, history OK (43 rows, last applied 0042), schema drift none, plain plan refused OBSOLETE_MIGRATION_PENDING [0043, 0044, 0045]',
    r.status === 0 && pre?.ok && pre.journal.ok && pre.history.ok && pre.history.rows === 43 && pre.history.lastApplied === '0042_r31_orientation_funding_pilot' && pre.drift.ok && pre.drift.expectedObjects > 1500
    && pre.plainPlan.reason === 'OBSOLETE_MIGRATION_PENDING' && JSON.stringify(pre.plainPlan.pending) === JSON.stringify([T43, T44, T45]), pre);
  r = cli(DB.P, ['--dry-run']);
  check('1-preflight', 'plain run on P refused (exit 3, OBSOLETE_MIGRATION_PENDING), nothing written', r.status === 3 && r.output.includes('OBSOLETE_MIGRATION_PENDING'), r.output.split('\n').at(-1));
  r = cli(DB.P, []);
  check('1-preflight', 'plain run without --dry-run on P refused too (exit 3)', r.status === 3 && r.output.includes('OBSOLETE_MIGRATION_PENDING'));
  for (const t of [T43, T44]) { r = cli(DB.P, ['--only', t]); check('1-preflight', `--only ${t} refused (OBSOLETE_MIGRATION_REFUSED)`, r.status === 3 && r.line('DB_DEPLOY_MIGRATE_ONLY')?.reason === 'OBSOLETE_MIGRATION_REFUSED'); }
  const refuse = stockMigrateRefusal(['node', 'drizzle-kit', 'migrate'], 'postgresql://u@ep-x.eu-central-1.aws.neon.tech/neondb');
  check('1-preflight', 'drizzle.config.ts refusal: drizzle-kit migrate / push against a non-local URL refused, local allowed', Boolean(refuse) && Boolean(stockMigrateRefusal(['n', 'k', 'push'], 'postgresql://u@db.example.invalid/x'))
    && stockMigrateRefusal(['n', 'k', 'migrate'], url(DB.P)) === null && stockMigrateRefusal(['n', 'k', 'generate'], 'postgresql://u@db.example.invalid/x') === null);
  const kit = spawnSync('npx', ['drizzle-kit', 'migrate'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', DATABASE_URL: 'postgresql://nobody@prod-shaped.invalid:5432/neondb' } });
  note('NODE_ENV=test DATABASE_URL=postgresql://nobody@prod-shaped.invalid:5432/neondb npx drizzle-kit migrate   # exit ' + kit.status, `${kit.stdout}${kit.stderr}`.replace(/\[dotenv[^\n]*\n/g, ''));
  check('1-preflight', 'real `npx drizzle-kit migrate` against a non-local URL stops in drizzle.config.ts before any connection (exit != 0, refusal text)', kit.status !== 0 && `${kit.stdout}${kit.stderr}`.includes('drizzle-kit migrate refused'));

  // 2. stock drizzle semantics on a clone of P: what a plain migrate() would do ------------------------------------------------------------------------
  await cloneOf(DB.P, DB.S);
  await stockMigrate(DB.S, MIG);
  const s2 = await withClient(DB.S, async (c) => ({ rows: await history(c), guest: await guestCols(c), def: await kindDef(c) }));
  check('2-stock', 'stock migrate() on a 0042 clone APPLIES 0043, 0044 and 0045 (46 rows, 11 guest columns, guest kinds in the CHECK) — the hazard the guard closes',
    s2.rows.length === 46 && s2.guest === 11 && s2.def.includes('BOOKED_BY_GUEST') && s2.def.includes('REQUEST_RECEIVED'), { rows: s2.rows.length, guest: s2.guest });
  await withClient(DB.S, async (c) => {
    const p = await preflight(c, MIG, { forbidObsoleteApplied: true });
    check('2-stock', 'guard on that database (Production rules): history finding OBSOLETE_MIGRATION_RECORDED for 0043 and 0044; any write refused', !p.ok && p.history.findings.filter((f) => f.code === 'OBSOLETE_MIGRATION_RECORDED').map((f) => f.tag).join() === `${T43},${T44}`, p.history.findings);
  });

  // 3. backup of P (pg_dump -Fc, as scripts/db-backup.mjs does before encrypting) ------------------------------------------------------------------
  await withClient(DB.P, async (c) => {
    await c.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt") VALUES ('r44-st', 'Structure fictive R44', 'r44-st', 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', NOW(), NOW())`);
    await c.query(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES ('r44-sv', 'r44-st', 'Accueil fictif', 30, NOW())`);
    await c.query(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "updatedAt") VALUES ('r44-ap', 'r44-st', 'r44-sv', '2099-05-01T09:00:00Z', '2099-05-01T09:30:00Z', 'Fictif', NOW())`);
    await c.query(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES ('r44-n0', 'r44-ap', 'RESCHEDULED', 'citizen', 'email', 'TEST_RECORDED')`);
  });
  const backup = path.join(WORK, 'p-before-0045.dump');
  tool('pg_dump', ['-Fc', '--no-owner', '-d', DB.P, '-f', backup]);
  const schemaBefore = schemaDump(DB.P);
  fs.writeFileSync(path.join(OUT, 'p-schema-before-0045.sql'), schemaBefore);
  const toc = tool('pg_restore', ['-l', backup]);
  check('3-backup', 'pg_dump -Fc of P written and readable (pg_restore -l lists the drizzle history table and AppointmentNotice)', fs.statSync(backup).size > 10_000 && toc.includes('__drizzle_migrations') && toc.includes('AppointmentNotice'), `${fs.statSync(backup).size} bytes, ${toc.split('\n').length} TOC lines`);

  // 4. targeted 0045 through the CLI (the Production command, --lab-rehearsal only lifts the loopback refusal) -----------------------------------------
  r = cli(DB.P, ['--only', T45, '--dry-run']);
  const dry = r.line('DB_DEPLOY_MIGRATE_ONLY');
  check('4-apply', '--only 0045 --dry-run: plan [0045], nothing written', r.status === 0 && dry?.ok && dry.dryRun === true && JSON.stringify(dry.apply) === JSON.stringify([T45]) && (await withClient(DB.P, history)).length === 43, dry);
  r = cli(DB.P, ['--only', T45]);
  check('4-apply', '--only 0045: applied', r.status === 0 && r.line('DB_DEPLOY_MIGRATE_ONLY')?.applied === T45, r.line('DB_DEPLOY_MIGRATE_ONLY'));
  const p4 = await withClient(DB.P, async (c) => {
    const ok = {}; for (const k of [...BOOK4, 'BOOKED_BY_GUEST', 'GUEST_CODE', 'MARKETING']) {
      await c.query('BEGIN');
      try { await c.query(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES ($1, 'r44-ap', $2, 'structure', 'in_app', 'DELIVERED')`, [`r44-probe-${k}`, k]); ok[k] = true; } catch { ok[k] = false; }
      await c.query('ROLLBACK');
    }
    return { rows: await history(c), def: await kindDef(c), guest: await guestCols(c), ok, old: Number((await c.query(`select count(*)::int n from "AppointmentNotice" where id = 'r44-n0'`)).rows[0].n) };
  });
  check('4-apply', 'after 0045: 44 rows, the new row = (id 44, sha256(0045 file), created_at 1793792402360) — byte-equal to the row drizzle writes', p4.rows.length === 44 && p4.rows[43].id === 44 && p4.rows[43].hash === files[T45].hash && p4.rows[43].hash === s2.rows[45].hash && p4.rows[43].created_at === String(e45.when), p4.rows[43]);
  check('4-apply', 'CHECK = 7 + 4 kinds; the 4 booking kinds accepted, BOOKED_BY_GUEST / GUEST_CODE / unknown refused; no guest column; the old RESCHEDULED row kept',
    BOOK4.every((k) => p4.ok[k]) && !p4.ok.BOOKED_BY_GUEST && !p4.ok.GUEST_CODE && !p4.ok.MARKETING && p4.guest === 0 && p4.old === 1, { def: p4.def, ok: p4.ok });
  r = cli(DB.P, ['--check']); pre = r.line('DB_DEPLOY_MIGRATE_PREFLIGHT');
  check('4-apply', '--check after 0045: no history or schema drift; the plain plan is EMPTY (0043/0044 permanently behind the newest row)', r.status === 0 && pre?.ok && pre.history.lastApplied === T45 && pre.plainPlan.ok && pre.plainPlan.apply.length === 0, pre);
  fs.writeFileSync(path.join(OUT, 'p-schema-after-0045.sql'), schemaDump(DB.P));
  fs.writeFileSync(path.join(OUT, 'p-history-after-0045.json'), JSON.stringify(p4.rows, null, 1));

  // 5. idempotence -----------------------------------------------------------------------------------------------------------------------------------
  r = cli(DB.P, ['--only', T45]);
  check('5-idempotent', 'a second --only 0045 answers ALREADY_APPLIED (exit 3), nothing written', r.status === 3 && r.line('DB_DEPLOY_MIGRATE_ONLY')?.reason === 'ALREADY_APPLIED');
  r = cli(DB.P, []);
  check('5-idempotent', 'a plain run applies nothing (DB_DEPLOY_MIGRATE_APPLIED [])', r.status === 0 && JSON.stringify(r.line('DB_DEPLOY_MIGRATE_APPLIED')) === '[]', r.output.split('\n').slice(-2).join(' | '));
  const sqlAgain = await withClient(DB.P, async (c) => { await c.query(files[T45].text); return { def: await kindDef(c), rows: (await history(c)).length }; });
  check('5-idempotent', 'the 0045 SQL run again by hand: same CHECK, still 44 rows', sqlAgain.def === p4.def && sqlAgain.rows === 44);

  // 6. stock migrate after 0045: 0043/0044 skipped for good --------------------------------------------------------------------------------------------
  await cloneOf(DB.P, DB.S);
  await stockMigrate(DB.S, MIG);
  const s6 = await withClient(DB.S, async (c) => ({ rows: (await history(c)).length, guest: await guestCols(c) }));
  check('6-stock-after', 'stock migrate() (= drizzle-kit migrate) on a 0042 + 0045 clone applies NOTHING: 44 rows, no guest column (it compares created_at, not names)', s6.rows === 44 && s6.guest === 0, s6);

  // 7. rollback (drizzle/rollback/0045_down.sql, one transaction, ON_ERROR_STOP) --------------------------------------------------------------------
  const rb = tool('psql', ['-d', DB.P, '-1', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(MIG, 'rollback', '0045_down.sql')]);
  note(`psql -d <${DB.P}> -1 -v ON_ERROR_STOP=1 -f drizzle/rollback/0045_down.sql`, rb || '(no output)');
  const schemaRb = schemaDump(DB.P);
  fs.writeFileSync(path.join(OUT, 'p-schema-after-rollback.sql'), schemaRb);
  const p7 = await withClient(DB.P, async (c) => ({ rows: await history(c), def: await kindDef(c) }));
  check('7-rollback', 'rollback: schema byte-identical to the pre-0045 dump; 43 rows identical to before; CHECK back to the seven kinds', schemaRb === schemaBefore && JSON.stringify(p7.rows) === JSON.stringify(p0.rows) && p7.def === p0.def);
  r = cli(DB.P, ['--dry-run']);
  check('7-rollback', 'after the rollback the plain run is refused again (OBSOLETE_MIGRATION_PENDING) — a stock migrate here WOULD apply 0043/0044 (see 2), so it stays refused by drizzle.config.ts on Production', r.status === 3 && r.output.includes('OBSOLETE_MIGRATION_PENDING'));

  // 8. reapply ---------------------------------------------------------------------------------------------------------------------------------------
  r = cli(DB.P, ['--only', T45]);
  const p8 = await withClient(DB.P, async (c) => ({ rows: await history(c), def: await kindDef(c) }));
  check('8-reapply', 'reapply --only 0045 == the first 0045 state (CHECK, row hash and created_at; id 45 because SERIAL does not reuse 44)', r.status === 0 && p8.def === p4.def && p8.rows.length === 44 && p8.rows[43].hash === p4.rows[43].hash && p8.rows[43].created_at === p4.rows[43].created_at, p8.rows[43]);

  // 9. restore of the backup ---------------------------------------------------------------------------------------------------------------------------
  await admin([`DROP DATABASE IF EXISTS ${DB.R}`, `CREATE DATABASE ${DB.R} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`, `ALTER DATABASE ${DB.R} SET timezone TO 'UTC'`]);
  const rs = spawnSync(path.join(PGBIN, 'pg_restore'), ['-h', HOST, '-p', PORT, '-U', USER, '--no-owner', '--exit-on-error', '-d', DB.R, backup], { encoding: 'utf8' });
  note(`pg_restore --no-owner --exit-on-error -d <${DB.R}> p-before-0045.dump   # exit ${rs.status}`, `${rs.stdout}${rs.stderr}` || '(no output)');
  const p9 = await withClient(DB.R, async (c) => ({ rows: await history(c), def: await kindDef(c), notice: Number((await c.query(`select count(*)::int n from "AppointmentNotice"`)).rows[0].n), pf: await preflight(c, MIG, { forbidObsoleteApplied: true }) }));
  check('9-restore', 'restore into a fresh database: exit 0, schema = pre-0045 dump, 43 identical history rows, the synthetic notice row, guard preflight OK (plain plan refused as on Production)',
    rs.status === 0 && schemaDump(DB.R) === schemaBefore && JSON.stringify(p9.rows) === JSON.stringify(p0.rows) && p9.def === p0.def && p9.notice === 1 && p9.pf.ok && p9.pf.plan.reason === 'OBSOLETE_MIGRATION_PENDING', { notice: p9.notice, plan: p9.pf.plan });
  r = cli(DB.R, ['--only', T45]);
  check('9-restore', 'the restored database takes --only 0045 like the original', r.status === 0 && r.line('DB_DEPLOY_MIGRATE_ONLY')?.applied === T45);

  // 10. a simulated future 0046 (staged copy of drizzle/ + one additive migration; never written to the repository) -------------------------------
  const f46 = stage('with0046', () => true, [{ entry: ENTRY46, sql: SQL46 }]);
  await cloneOf(DB.P, DB.X);   // P is now 0042 + 0045
  r = cli(DB.P, ['--dry-run'], f46);
  check('10-0046', 'Production shape + 0045, staged 0046: plain plan = [0046] only (0043/0044 not pending, nothing refused)', r.status === 0 && JSON.stringify(r.line('DB_DEPLOY_MIGRATE_PLAN')) === JSON.stringify([T46]), r.line('DB_DEPLOY_MIGRATE_PLAN'));
  r = cli(DB.P, [], f46);
  const p10 = await withClient(DB.P, async (c) => ({ rows: await history(c), probe: (await c.query(`select to_regclass('"R44RehearsalProbe"') is not null e`)).rows[0].e, guest: await guestCols(c) }));
  check('10-0046', 'plain run applies 0046: 45 rows (0000..0042, 0045, 0046), probe table present, still no guest column', r.status === 0 && JSON.stringify(r.line('DB_DEPLOY_MIGRATE_APPLIED')) === JSON.stringify([T46]) && p10.rows.length === 45 && p10.probe && p10.guest === 0
    && p10.rows[44].created_at === String(ENTRY46.when) && p10.rows[44].hash === sha256(SQL46), p10.rows.at(-1));
  await stockMigrate(DB.X, f46);
  const x10 = await withClient(DB.X, async (c) => ({ rows: await history(c), guest: await guestCols(c) }));
  check('10-0046', 'stock migrate() with the staged 0046 on the same clone applies exactly 0046 too; history (hash, created_at) identical to the CLI result', x10.guest === 0 && JSON.stringify(x10.rows.map((x) => [x.hash, x.created_at])) === JSON.stringify(p10.rows.map((x) => [x.hash, x.created_at])), x10.rows.length);
  r = cli(DB.P, ['--check'], f46); pre = r.line('DB_DEPLOY_MIGRATE_PREFLIGHT');
  check('10-0046', '--check after 0046: no drift (probe table and index expected and present), plain plan empty', r.status === 0 && pre?.ok && pre.plainPlan.apply.length === 0, pre?.drift);
  // a 0046 generated with an earlier « when » than 0045 would be silently skipped by drizzle: refused by the journal check
  const bad = stage('bad0046', () => true, [{ entry: { ...ENTRY46, when: e45.when - 1 }, sql: SQL46 }]);
  r = cli(DB.X, ['--check'], bad); pre = r.line('DB_DEPLOY_MIGRATE_PREFLIGHT');
  check('10-0046', 'a staged 0046 whose « when » is not after 0045 → JOURNAL WHEN_NOT_INCREASING (exit 5)', r.status === 5 && pre?.journal.problems.some((p) => p.code === 'WHEN_NOT_INCREASING' && p.tag === T46), pre?.journal);
  r = cli(DB.X, ['--dry-run'], bad);
  check('10-0046', '…and the plain run refuses it (JOURNAL_INTEGRITY)', r.status === 3 && r.output.includes('JOURNAL_INTEGRITY'));
  // the full LAB chain takes 0046 the same way
  await cloneOf(DB.F, DB.N);
  r = cli(DB.N, ['--dry-run'], f46);
  check('10-0046', 'LAB full chain (0000..0045): the CLI refuses it — 0043/0044 recorded (OBSOLETE_MIGRATION_RECORDED: not a Production-shaped database)', r.status === 3 && r.output.includes('OBSOLETE_MIGRATION_RECORDED'));
  const n10 = await withClient(DB.N, (c) => applyPending(c, f46, { forbidObsoleteApplied: false }));
  check('10-0046', 'LAB full chain with LAB rules (applyPending, obsolete allowed): applies exactly [0046]', n10.ok && JSON.stringify(n10.applied) === JSON.stringify([T46]), n10);

  // 11. drift detection: negative cases on a clone of the restored 0042 database ------------------------------------------------------------------------
  const negative = async (label, sqls, expectCode, opts = {}) => {
    await cloneOf(DB.R, DB.N);
    await withClient(DB.N, async (c) => { for (const s of sqls) await c.query(s); });
    const p = await withClient(DB.N, (c) => preflight(c, opts.folder || MIG, { forbidObsoleteApplied: true }));
    const all = [...p.journal.problems, ...p.history.findings, ...p.drift.findings];
    const w = await withClient(DB.N, (c) => applyOnly(c, opts.folder || MIG, opts.only || T45, { physical: true, forbidObsoleteApplied: true }));
    const after = await withClient(DB.N, async (c) => (await history(c)).length);
    check('11-drift', `${label} → ${expectCode}; --only refused (${w.reason}), history unchanged`, !p.ok && all.some((f) => f.code === expectCode) && !w.ok && after === opts.rows, all.slice(0, 4));
  };
  // DB.R has 0045 applied (step 9) → 44 rows; first undo it to get a 0042 base for the cases
  await withClient(DB.R, async (c) => { await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(MIG, 'rollback', '0045_down.sql'), 'utf8')); await c.query('COMMIT'); });
  await negative('a guest column added by hand (0043 object without its history row)', ['ALTER TABLE "ProAppointment" ADD COLUMN "guestEmail" text'], 'PHYSICAL_OBJECT_UNRECORDED', { rows: 43 });
  await negative('the 0045 CHECK applied by hand without its history row', [files[T45].text], 'CHECK_CHANGE_UNRECORDED', { rows: 43 });
  await negative('a 0042 table dropped by hand', ['DROP TABLE "PilotSession"'], 'PHYSICAL_OBJECT_MISSING', { rows: 43 });
  await negative('a history hash altered', [`UPDATE drizzle.__drizzle_migrations SET hash = 'x' WHERE id = 10`], 'HISTORY_HASH_MISMATCH', { rows: 43 });
  await negative('a history row unknown to the journal', [`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', 1700000000000)`], 'UNKNOWN_HISTORY_ROW', { rows: 44 });
  await negative('a history row deleted (0030 behind the newest row: drizzle would skip it for ever)', [`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${journalAll.entries[30].when}`], 'SKIPPED_MIGRATION', { rows: 42 });
  await negative('a 0043 history row forged without its objects', [`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${files[T43].hash}', ${journalAll.entries[43].when})`], 'OBSOLETE_MIGRATION_RECORDED', { rows: 44 });
  const renamed = stage('renamed43', () => true);
  fs.renameSync(path.join(renamed, `${T43}.sql`), path.join(renamed, '0043_r44_renamed.sql'));
  const jr = JSON.parse(fs.readFileSync(path.join(renamed, 'meta', '_journal.json'), 'utf8')); jr.entries[43].tag = '0043_r44_renamed'; fs.writeFileSync(path.join(renamed, 'meta', '_journal.json'), JSON.stringify(jr));
  await negative('0043 renamed in a staged journal (same « when » and file)', [], 'OBSOLETE_MIGRATION_RENAMED', { rows: 43, folder: renamed });

  // 12. the LAB full chain is consistent with LAB rules -----------------------------------------------------------------------------------------------
  const f12 = await withClient(DB.F, (c) => preflight(c, MIG, { forbidObsoleteApplied: false }));
  check('12-lab', 'F (full chain, stock migrate): journal, history and schema consistent under LAB rules (46 rows, drift none, nothing pending)', f12.ok && f12.history.rows === 46 && f12.plan.ok && f12.plan.apply.length === 0, { history: f12.history.findings, drift: f12.drift.findings.slice(0, 5) });
}

const t0 = Date.now();
main().then(async () => {
  if (!keep) await admin(Object.values(DB).map((d) => `DROP DATABASE IF EXISTS ${d}`));
  const pass = checks.filter((c) => c.ok).length; const fail = checks.length - pass;
  fs.writeFileSync(path.join(OUT, 'rehearsal.json'), JSON.stringify({ rehearsal: 'R44 migration safety (0045 targeted, 0043/0044 never)', at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), pass, fail, checks, commands: log, databasesDropped: !keep }, null, 1));
  console.log(`REHEARSAL ${JSON.stringify({ pass, fail })}`);
  process.exitCode = fail ? 1 : 0;
}).catch(async (e) => {
  console.error(e);
  if (!keep) await admin(Object.values(DB).map((d) => `DROP DATABASE IF EXISTS ${d}`)).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'rehearsal.json'), JSON.stringify({ error: String(e?.stack || e), checks, commands: log }, null, 1));
  process.exitCode = 2;
});
