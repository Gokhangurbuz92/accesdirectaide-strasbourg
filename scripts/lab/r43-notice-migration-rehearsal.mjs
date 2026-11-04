#!/usr/bin/env node
/**
 * R43-E — LAB rehearsal of migration 0045 (AppointmentNotice kind CHECK) with the Production procedure's own code (scripts/db-deploy-migrate.mjs applyOnly /
 * planDeploy) on a disposable CLONE of a local database: backup (pg_dump) → plan → apply → verify → rollback (drizzle/rollback/0045_down.sql) → verify
 * (schema identical to the backup's) → reapply → verify → restore of the backup into a second scratch database → verify. Synthetic rows only.
 *
 *   node scripts/lab/r43-notice-migration-rehearsal.mjs --source <local db at 0042 or 0044> --out <evidence dir> [--pg-bin <dir>] [--keep]
 *
 * Refuses (exit 3, nothing touched) unless the server is 127.0.0.1:55434 / localhost and every database name involved contains lab / test / e2e.
 * Credentials: none (the LAB cluster uses trust auth for ada_test); no URL or secret is printed or written.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyOnly, planDeploy } from '../db-deploy-migrate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TAG = '0045_r43_appointment_notice_kinds';
const NEW_KINDS = ['BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED'];
const BASE_KINDS = ['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_CITIZEN', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED'];
const GUEST_KINDS = ['BOOKED_BY_GUEST', 'GUEST_CODE'];
const LAB_NAME = /(^|_)(lab|test|e2e)(_|$)/i;

const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const source = String(arg('--source', ''));
const out = String(arg('--out', ''));
const PGBIN = String(arg('--pg-bin', '/opt/homebrew/opt/postgresql@17/bin'));
const HOST = '127.0.0.1'; const PORT = '55434'; const USER = 'ada_test';
const keep = process.argv.includes('--keep');
if (!source || !out || !LAB_NAME.test(source) || !/^[a-z0-9_]+$/.test(source)) { console.error('REHEARSAL {"ok":false,"reason":"LAB_DATABASE_REQUIRED"}'); process.exit(3); }
const clone = `${source}_r43c`.slice(0, 60); const restored = `${source}_r43r`.slice(0, 60);
if (!LAB_NAME.test(clone) || !LAB_NAME.test(restored)) { console.error('REHEARSAL {"ok":false,"reason":"LAB_DATABASE_REQUIRED"}'); process.exit(3); }
fs.mkdirSync(out, { recursive: true });

const url = (db) => `postgresql://${USER}@${HOST}:${PORT}/${db}`;
const bin = (tool) => path.join(PGBIN, tool);
const run = (tool, args) => execFileSync(bin(tool), ['-h', HOST, '-p', PORT, '-U', USER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const checks = []; const check = (step, label, ok, detail = '') => { checks.push({ step, label, ok: Boolean(ok), ...(detail ? { detail } : {}) }); console.log(`${ok ? 'PASS' : 'FAIL'} [${step}] ${label}${detail ? ` — ${detail}` : ''}`); };

async function withClient(db, fn) { const c = new pg.Client({ connectionString: url(db) }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const kindsOf = async (c) => {
  const r = await c.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'AppointmentNotice_kind_check'`);
  return [...String(r.rows[0]?.def || '').matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
};
const journal = async (c) => (await c.query('SELECT count(*)::int AS n, max(created_at)::text AS last FROM drizzle.__drizzle_migrations')).rows[0];
const accepts = async (c, kind, appointmentId) => {
  await c.query('BEGIN');
  try { await c.query(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES ($1, $2, $3, 'structure', 'in_app', 'DELIVERED')`, [`r43-probe-${kind}`, appointmentId, kind]); return true; }
  catch { return false; } finally { await c.query('ROLLBACK'); }
};
const schemaDump = (db) => run('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '-d', db]).split('\n').filter((l) => !/^-- (Dumped|Started|Completed)/.test(l) && !/^\\(un)?restrict /.test(l)).join('\n');
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')).entries;
const target = entries.find((e) => e.tag === TAG);

async function main() {
  const admin = new pg.Client({ connectionString: url('postgres') }); await admin.connect();
  try {
    for (const db of [clone, restored]) await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.query(`CREATE DATABASE ${clone} TEMPLATE ${source}`);
    await admin.query(`ALTER DATABASE ${clone} SET timezone TO 'UTC'`);
  } finally { await admin.end(); }

  const level = await withClient(clone, async (c) => {
    const j = await journal(c);
    const guest = (await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name = 'guestEmailHash'`)).rows[0].n === 1;
    return { journalRows: j.n, last: j.last, guestColumns: guest };
  });
  const lvl = level.guestColumns ? '0044' : '0042';
  check('0-clone', `clone of ${source} is at ${lvl}`, (lvl === '0042' && level.journalRows === 43) || (lvl === '0044' && level.journalRows === 45), JSON.stringify(level));

  // synthetic rows: one structure, one appointment, one ledger row per kind the database accepts today
  const apptId = `r43-rehearsal-appt`;
  const before = await withClient(clone, async (c) => {
    await c.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES ('r43-rehearsal-st', 'Structure fictive répétition R43', 'r43-rehearsal-st', 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await c.query(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES ('r43-rehearsal-svc', 'r43-rehearsal-st', 'Accueil fictif', 30, 0, 0, true, NOW())`);
    await c.query(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "idempotencyKey", "updatedAt") VALUES ($1, 'r43-rehearsal-st', 'r43-rehearsal-svc', NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', 'confirmed', 'Particulier fictif', 'r43-rehearsal', NOW())`, [apptId]);
    const kinds = await kindsOf(c);
    for (const k of kinds) await c.query(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES ($1, $2, $3, 'citizen', 'email', 'TEST_RECORDED')`, [`r43-old-${k}`, apptId, k]);
    return { kinds, rows: (await c.query(`SELECT count(*)::int AS n FROM "AppointmentNotice"`)).rows[0].n };
  });
  const expectedBefore = lvl === '0044' ? [...BASE_KINDS, ...GUEST_KINDS] : BASE_KINDS;
  check('0-clone', 'kind CHECK before = 0020 kinds' + (lvl === '0044' ? ' + 0043 guest kinds' : ''), JSON.stringify(before.kinds) === JSON.stringify(expectedBefore), before.kinds.join(','));

  // 1. backup
  const backup = path.join(out, `backup-${lvl}-before-0045.dump`);
  run('pg_dump', ['-Fc', '--no-owner', '-d', clone, '-f', backup]);
  const schemaBefore = schemaDump(clone);
  fs.writeFileSync(path.join(out, `schema-${lvl}-before.sql`), schemaBefore);
  check('1-backup', 'pg_dump custom-format backup written', fs.statSync(backup).size > 1000, `${fs.statSync(backup).size} bytes`);

  // 2. plan: the plain run refuses on 0042 (0043/0044 would be applied first); --only plans exactly 0045
  await withClient(clone, async (c) => {
    const j = await journal(c);
    const plain = planDeploy(entries, Number(j.last));
    if (lvl === '0042') check('2-plan', 'plain migrate run refused: obsolete 0043/0044 pending', !plain.ok && plain.reason === 'OBSOLETE_MIGRATION_PENDING', JSON.stringify(plain));
    else check('2-plan', 'plain migrate run would apply only 0045', plain.ok && plain.apply.map((e) => e.tag).join() === TAG, JSON.stringify(plain.ok ? plain.apply.map((e) => e.tag) : plain));
    const dry = await applyOnly(c, path.join(ROOT, 'drizzle'), TAG, { dryRun: true });
    check('2-plan', '--only 0045 --dry-run plans exactly 0045 and changes nothing', dry.ok && dry.apply.map((e) => e.tag).join() === TAG && (await journal(c)).n === j.n, JSON.stringify({ ok: dry.ok, apply: dry.ok ? dry.apply.map((e) => e.tag) : null }));
  });

  const verifyApplied = async (step) => withClient(clone, async (c) => {
    const kinds = await kindsOf(c);
    check(step, 'kind CHECK = previous kinds + the four booking kinds', JSON.stringify(kinds) === JSON.stringify([...expectedBefore, ...NEW_KINDS]), kinds.join(','));
    for (const k of NEW_KINDS) check(step, `ledger accepts ${k}`, await accepts(c, k, apptId));
    check(step, 'ledger still refuses an unknown kind', !(await accepts(c, 'REQUEST_EXPIRED', apptId)));
    if (lvl === '0042') for (const k of GUEST_KINDS) check(step, `0043 kind ${k} NOT introduced on a 0042 database`, !(await accepts(c, k, apptId)));
    const j = await journal(c);
    check(step, 'one journal row added, created_at = the journal « when » of 0045', j.n === level.journalRows + 1 && Number(j.last) === target.when, JSON.stringify(j));
    const guest = (await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name LIKE 'guest%'`)).rows[0].n;
    check(step, lvl === '0042' ? 'no 0043/0044 column appeared (obsolete migrations not applied)' : '0043/0044 columns untouched', lvl === '0042' ? guest === 0 : guest === 11, `guest columns ${guest}`);
    check(step, 'every existing ledger row kept', (await c.query(`SELECT count(*)::int AS n FROM "AppointmentNotice" WHERE id LIKE 'r43-old-%'`)).rows[0].n === before.rows);
    const plain = planDeploy(entries, Number(j.last));
    check(step, 'afterwards a plain migrate run has nothing pending', plain.ok && plain.apply.length === 0, JSON.stringify(plain.ok ? plain.apply.map((e) => e.tag) : plain));
  });

  // 3. apply with the Production code path
  const applied = await withClient(clone, (c) => applyOnly(c, path.join(ROOT, 'drizzle'), TAG));
  check('3-apply', 'applyOnly(0045) committed', applied.ok && applied.applied === TAG, JSON.stringify(applied));
  await verifyApplied('3-apply');
  // idempotence of the SQL itself, and a second --only answers ALREADY_APPLIED
  await withClient(clone, async (c) => {
    await c.query(fs.readFileSync(path.join(ROOT, 'drizzle', `${TAG}.sql`), 'utf8'));
    check('3-apply', 'the migration SQL run twice gives the same CHECK', JSON.stringify(await kindsOf(c)) === JSON.stringify([...expectedBefore, ...NEW_KINDS]));
    const again = await applyOnly(c, path.join(ROOT, 'drizzle'), TAG);
    check('3-apply', 'a second --only run is refused (ALREADY_APPLIED), nothing written', !again.ok && again.reason === 'ALREADY_APPLIED' && (await journal(c)).n === level.journalRows + 1, JSON.stringify(again));
    for (const k of NEW_KINDS) await c.query(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status) VALUES ($1, $2, $3, 'structure', 'in_app', 'DELIVERED')`, [`r43-new-${k}`, apptId, k]);
  });
  fs.writeFileSync(path.join(out, `schema-${lvl}-after-0045.sql`), schemaDump(clone));

  // 4. rollback with the repository's rollback file (one transaction, stop on error)
  run('psql', ['-d', clone, '-v', 'ON_ERROR_STOP=1', '-1', '-q', '-f', path.join(ROOT, 'drizzle/rollback/0045_down.sql')]);
  await withClient(clone, async (c) => {
    const kinds = await kindsOf(c);
    check('4-rollback', 'kind CHECK back to the previous kinds', JSON.stringify(kinds) === JSON.stringify(expectedBefore), kinds.join(','));
    const j = await journal(c);
    check('4-rollback', 'journal row of 0045 removed', j.n === level.journalRows && j.last === level.last, JSON.stringify(j));
    check('4-rollback', 'ledger rows of the four booking kinds deleted', (await c.query(`SELECT count(*)::int AS n FROM "AppointmentNotice" WHERE kind = ANY($1)`, [NEW_KINDS])).rows[0].n === 0);
    check('4-rollback', 'every older ledger row kept', (await c.query(`SELECT count(*)::int AS n FROM "AppointmentNotice" WHERE id LIKE 'r43-old-%'`)).rows[0].n === before.rows);
    for (const k of NEW_KINDS) check('4-rollback', `ledger refuses ${k} again`, !(await accepts(c, k, apptId)));
  });
  const schemaRolledBack = schemaDump(clone);
  fs.writeFileSync(path.join(out, `schema-${lvl}-after-rollback.sql`), schemaRolledBack);
  check('4-rollback', 'schema after rollback is byte-identical to the backup\'s schema', schemaRolledBack === schemaBefore);

  // 5. reapply
  const re = await withClient(clone, (c) => applyOnly(c, path.join(ROOT, 'drizzle'), TAG));
  check('5-reapply', 'applyOnly(0045) committed again', re.ok && re.applied === TAG, JSON.stringify(re));
  await verifyApplied('5-reapply');

  // 6. the backup restores to the pre-migration state
  const admin2 = new pg.Client({ connectionString: url('postgres') }); await admin2.connect();
  try { await admin2.query(`CREATE DATABASE ${restored} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`); } finally { await admin2.end(); }
  run('pg_restore', ['--no-owner', '-d', restored, backup]);
  await withClient(restored, async (c) => {
    const j = await journal(c);
    check('6-restore', 'restored backup: journal at the pre-migration level', j.n === level.journalRows && j.last === level.last, JSON.stringify(j));
    check('6-restore', 'restored backup: previous kind CHECK and rows', JSON.stringify(await kindsOf(c)) === JSON.stringify(expectedBefore) && (await c.query(`SELECT count(*)::int AS n FROM "AppointmentNotice"`)).rows[0].n === before.rows);
  });
  check('6-restore', 'restored schema is byte-identical to the backup\'s schema', schemaDump(restored) === schemaBefore);

  if (!keep) {
    const a = new pg.Client({ connectionString: url('postgres') }); await a.connect();
    try { for (const db of [clone, restored]) await a.query(`DROP DATABASE IF EXISTS ${db}`); } finally { await a.end(); }
  }
  const failed = checks.filter((c) => !c.ok).length;
  const report = { rehearsal: 'R43-E migration 0045', source, level: lvl, migration: TAG, when: target.when, at: new Date().toISOString(), pass: checks.length - failed, fail: failed, checks };
  fs.writeFileSync(path.join(out, `rehearsal-${lvl}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`REHEARSAL ${JSON.stringify({ level: lvl, pass: report.pass, fail: report.fail })}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(`REHEARSAL {"ok":false,"error":${JSON.stringify(String(e?.message || e).slice(0, 300))}}`); process.exit(1); });
