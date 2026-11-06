#!/usr/bin/env node
/**
 * Public beta (owner directive 29/10/2026): apply the repository's Drizzle migrations to the NEW production database (Neon, Frankfurt).
 * Uses the direct (unpooled) connection — DDL and the migrator's lock do not belong on the transaction pooler — with a verified TLS certificate.
 * Refuses a loopback host, so it can never touch the local LAB database. Prints the target identity and the result, never a credential.
 *
 *   DATABASE_URL_UNPOOLED=… node scripts/db-deploy-migrate.mjs [--check]     (--check: read-only identity, journal, history and schema-drift report)
 *   DATABASE_URL_UNPOOLED=… node scripts/db-deploy-migrate.mjs --dry-run      (plain plan, nothing written)
 *   DATABASE_URL_UNPOOLED=… node scripts/db-deploy-migrate.mjs --only 0045_r43_appointment_notice_kinds [--dry-run]
 *   DATABASE_URL_UNPOOLED=postgresql://…@127.0.0.1:55434/<name>_test node scripts/db-deploy-migrate.mjs --lab-rehearsal …   (LAB rehearsal only, see below)
 *
 * R43-E: migrations 0043 / 0044 (retired account-free booking) are OBSOLETE and must never reach Production. Drizzle's migrator applies every journal entry
 * whose « when » is later than the newest recorded one, so a plain run on a database at 0042 would apply 0043 and 0044 before any later migration: the
 * plain run REFUSES when an obsolete migration is pending (OBSOLETE_MIGRATION_PENDING). `--only <tag>` applies exactly one migration, in one
 * transaction, with drizzle's own journal row (sha256 of the file, created_at = its « when »), and only when every migration pending before it is an
 * obsolete one; afterwards the plain run sees nothing pending (0043 / 0044 stay unapplied for good). `--dry-run` prints the plan and changes nothing.
 *
 * R44: every run first verifies the journal (scripts/db-migrate-guard.mjs: obsolete migrations pinned by idx / « when » / sha256, « when » strictly
 * increasing, one file per entry), the recorded history (each row = a journal entry with the same hash, no duplicate, no migration skipped behind the
 * newest row, no obsolete migration recorded) and the physical schema against that history (objects of the recorded migrations present, objects of the
 * unrecorded ones absent, CHECK markers): any finding refuses the write (HISTORY_DRIFT / SCHEMA_DRIFT / JOURNAL_INTEGRITY). The plain run no longer hands
 * over to drizzle's migrate(): it applies the plan itself, re-planned under an advisory lock, in ONE transaction, statement by statement and row by row
 * exactly as drizzle does (same split, same hash, same created_at), so the plan that was checked is the plan that runs.
 * `--lab-rehearsal`: lets the CLI run against a loopback database whose name ends in « _test » (no TLS), for the LAB rehearsal, optionally on a staged
 * migrations folder (`--migrations <dir>`, rehearsal only); nothing else.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  OBSOLETE_MIGRATIONS, auditHistory, isLocalDatabaseUrl, loadMigrations, physicalDrift, planDeploy, preflight, readCatalogue, readHistory, verifyJournal,
} from './db-migrate-guard.mjs';
import { isMainModule } from './lib/is-main.mjs';

export { OBSOLETE_MIGRATIONS, planDeploy };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = ['vector', 'unaccent', 'pg_trgm'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOCK = `SELECT pg_advisory_xact_lock(hashtextextended('ada:db-deploy-migrate', 0))`;

/** @param {string | undefined} url */
export function targetOf(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return { ok: false, reason: 'NO_DIRECT_DATABASE_URL' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, reason: 'NOT_POSTGRES' };
  if (LOOPBACK.has(u.hostname)) return { ok: false, reason: 'LOOPBACK_REFUSED' };
  if (/-pooler\./.test(u.hostname)) return { ok: false, reason: 'POOLED_URL_REFUSED' };
  const region = (u.hostname.match(/\.(([a-z]{2,}-[a-z]+-\d)\.aws)\.neon\.tech$/) || [])[2] || 'unknown';
  return { ok: true, region, database: u.pathname.replace(/^\//, '') };
}

/** --lab-rehearsal: only a local database named « …_test » */
export function rehearsalTargetOf(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return { ok: false, reason: 'NO_DIRECT_DATABASE_URL' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, reason: 'NOT_POSTGRES' };
  if (!isLocalDatabaseUrl(url)) return { ok: false, reason: 'REHEARSAL_NEEDS_A_LOCAL_DATABASE' };
  const database = u.pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+_test$/.test(database)) return { ok: false, reason: 'REHEARSAL_NEEDS_A_TEST_DATABASE' };
  return { ok: true, region: 'lab', database };
}

/** inside the open transaction: journal + history (+ schema) checks, then the plan; null = go on */
async function guardInTx(client, m, only, { physical, forbidObsoleteApplied }) {
  const journal = verifyJournal(m);
  if (!journal.ok) return { ok: false, reason: 'JOURNAL_INTEGRITY', problems: journal.problems };
  const history = auditHistory(m.entries, m.files, await readHistory(client), { forbidObsoleteApplied });
  if (!history.ok) return { ok: false, reason: 'HISTORY_DRIFT', findings: history.findings };
  if (physical) {
    const drift = physicalDrift(m.entries, m.files, history.applied, await readCatalogue(client));
    if (!drift.ok) return { ok: false, reason: 'SCHEMA_DRIFT', findings: drift.findings };
  }
  return { ok: true, plan: planDeploy(m.entries, history.lastCreatedAt, only) };
}

async function applyEntries(client, m, apply) {
  for (const entry of apply) {
    const { text, hash } = m.files[entry.tag];
    for (const stmt of text.split('--> statement-breakpoint')) if (stmt.trim()) await client.query(stmt);
    await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash, entry.when]);
  }
}

/**
 * Applies exactly one journal migration, as drizzle would (statements split on its breakpoint marker, then its journal row), in ONE transaction, after
 * the guard and planDeploy() agreed under an advisory lock. Used by --only, the LAB rehearsals and the native QA (r43_qa_migrate_v26).
 * @param {import('pg').Client} client @param {string} migrationsFolder @param {string} tag
 * @param {{ dryRun?: boolean, physical?: boolean, forbidObsoleteApplied?: boolean }} [opts]
 */
export async function applyOnly(client, migrationsFolder, tag, { dryRun = false, physical = false, forbidObsoleteApplied = false } = {}) {
  const m = loadMigrations(migrationsFolder);
  await client.query('BEGIN');
  try {
    await client.query(LOCK);
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    const g = await guardInTx(client, m, tag, { physical, forbidObsoleteApplied });
    if (!g.ok) { await client.query('ROLLBACK'); return g; }
    const plan = g.plan;
    if (!plan.ok || dryRun) { await client.query('ROLLBACK'); return { ...plan, dryRun }; }
    await applyEntries(client, m, plan.apply);
    await client.query('COMMIT');
    return { ok: true, applied: plan.apply[0].tag };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/**
 * The plain run: every pending migration (drizzle's rule), refused while an obsolete one is pending, re-planned and applied under the advisory lock in ONE
 * transaction, exactly as drizzle's migrate() would write it.
 * @param {import('pg').Client} client @param {string} migrationsFolder
 * @param {{ dryRun?: boolean, physical?: boolean, forbidObsoleteApplied?: boolean }} [opts]
 */
export async function applyPending(client, migrationsFolder, { dryRun = false, physical = true, forbidObsoleteApplied = true } = {}) {
  const m = loadMigrations(migrationsFolder);
  await client.query('BEGIN');
  try {
    await client.query(LOCK);
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    const g = await guardInTx(client, m, null, { physical, forbidObsoleteApplied });
    if (!g.ok) { await client.query('ROLLBACK'); return g; }
    const plan = g.plan;
    if (!plan.ok || dryRun) { await client.query('ROLLBACK'); return plan.ok ? { ok: true, apply: plan.apply.map((e) => e.tag), dryRun } : plan; }
    await applyEntries(client, m, plan.apply);
    await client.query('COMMIT');
    return { ok: true, applied: plan.apply.map((e) => e.tag) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const onlyAt = process.argv.indexOf('--only');
  const only = onlyAt > 0 ? String(process.argv[onlyAt + 1] || '') : null;
  const dryRun = process.argv.includes('--dry-run');
  const rehearsal = process.argv.includes('--lab-rehearsal');
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  const t = rehearsal ? rehearsalTargetOf(url) : targetOf(url);
  if (!t.ok) { console.error(`DB_DEPLOY_MIGRATE {"ok":false,"reason":"${t.reason}"}`); process.exit(2); }
  const client = new pg.Client({ connectionString: url, ssl: rehearsal ? false : { rejectUnauthorized: true } });
  await client.connect();
  try {
    const id = (await client.query(`select current_database() as db, current_setting('server_version') as version`)).rows[0];
    console.log(`DB_TARGET ${JSON.stringify({ region: t.region, database: id.db, postgres: id.version })}`);
    // a rehearsal may point at a staged copy of drizzle/ (e.g. with a simulated future migration); a real run always uses the repository's own folder
    const migAt = process.argv.indexOf('--migrations');
    const folder = rehearsal && migAt > 0 ? path.resolve(String(process.argv[migAt + 1] || '')) : path.join(ROOT, 'drizzle');
    const strict = { physical: true, forbidObsoleteApplied: true };
    if (check) {
      const p = await preflight(client, folder, { forbidObsoleteApplied: true });
      const report = {
        ok: p.ok, journal: p.journal, history: { ok: p.history.ok, rows: p.history.rows, lastCreatedAt: p.history.lastCreatedAt, applied: p.history.applied.length,
          lastApplied: p.history.applied.at(-1) || null, findings: p.history.findings },
        drift: { ok: p.drift.ok, expectedObjects: p.drift.expected, findings: p.drift.findings },
        plainPlan: p.plan.ok ? { ok: true, apply: p.plan.apply.map((e) => e.tag) } : p.plan,
        obsoleteNeverApplied: OBSOLETE_MIGRATIONS,
      };
      console.log(`DB_DEPLOY_MIGRATE_PREFLIGHT ${JSON.stringify(report)}`);
      if (!p.ok) process.exitCode = 5;
    } else if (only !== null) {
      if (!only) { console.error('DB_DEPLOY_MIGRATE {"ok":false,"reason":"ONLY_NEEDS_A_TAG"}'); process.exit(2); }
      const out = await applyOnly(client, folder, only, { dryRun, ...strict });
      console.log(`DB_DEPLOY_MIGRATE_ONLY ${JSON.stringify(out.ok && out.apply ? { ...out, apply: out.apply.map((e) => e.tag) } : out)}`);
      if (!out.ok) process.exitCode = 3;
    } else {
      if (!dryRun) for (const e of EXTENSIONS) await client.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
      const out = await applyPending(client, folder, { dryRun, ...strict });
      if (!out.ok) { console.error(`DB_DEPLOY_MIGRATE ${JSON.stringify(out)}`); process.exit(3); }
      if (dryRun) { console.log(`DB_DEPLOY_MIGRATE_PLAN ${JSON.stringify(out.apply)}`); return; }
      console.log(`DB_DEPLOY_MIGRATE_APPLIED ${JSON.stringify(out.applied)}`);
    }
    const ext = (await client.query(`select extname, extversion from pg_extension where extname = any($1) order by extname`, [EXTENSIONS])).rows;
    const applied = await client.query(`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`).then((r) => r.rows[0]).catch(() => ({ n: 0, last: null }));
    const tables = (await client.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public'`)).rows[0].n;
    console.log(`DB_DEPLOY_MIGRATE ${JSON.stringify({ ok: process.exitCode ? false : true, mode: check ? 'check' : only !== null ? 'only' : 'migrate', dryRun, extensions: ext, migrationsApplied: applied.n, lastCreatedAt: applied.last, publicTables: tables })}`);
  } finally {
    await client.end();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(`DB_DEPLOY_MIGRATE {"ok":false,"error":${JSON.stringify(String(e?.code || e?.message || e).slice(0, 200))}}`); process.exit(1); });
}

