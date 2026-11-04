#!/usr/bin/env node
/**
 * Public beta (owner directive 29/10/2026): apply the repository's Drizzle migrations to the NEW production database (Neon, Frankfurt).
 * Uses the direct (unpooled) connection — DDL and the migrator's lock do not belong on the transaction pooler — with a verified TLS certificate.
 * Refuses a loopback host, so it can never touch the local LAB database. Prints the target identity and the result, never a credential.
 *
 *   DATABASE_URL_UNPOOLED=… node scripts/db-deploy-migrate.mjs [--check]     (--check: read-only identity + schema report, no change)
 *   DATABASE_URL_UNPOOLED=… node scripts/db-deploy-migrate.mjs --only 0045_r43_appointment_notice_kinds [--dry-run]
 *
 * R43-E: migrations 0043 / 0044 (retired account-free booking) are OBSOLETE and must never reach Production. Drizzle's migrator applies every journal entry
 * whose « when » is later than the newest recorded one, so a plain run on a database at 0042 would apply 0043 and 0044 before any later migration: the
 * plain run now REFUSES when an obsolete migration is pending (OBSOLETE_MIGRATION_PENDING). `--only <tag>` applies exactly one migration, in one
 * transaction, with drizzle's own journal row (sha256 of the file, created_at = its « when »), and only when every migration pending before it is an
 * obsolete one; afterwards the plain run sees nothing pending (0043 / 0044 stay unapplied for good). `--dry-run` prints the plan and changes nothing.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = ['vector', 'unaccent', 'pg_trgm'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

/** the retired guest-booking migrations (R42 DEC-R42-01): kept in the history for LAB databases, never applied in Production */
export const OBSOLETE_MIGRATIONS = Object.freeze(['0043_r38_guest_booking', '0044_r39_guest_reminder_consent']);

/**
 * What a run would apply. Pure: the journal entries, the newest created_at recorded in drizzle.__drizzle_migrations (null = empty database), the --only tag.
 * @param {Array<{ idx: number, when: number, tag: string }>} entries @param {number | null} lastCreatedAt @param {string | null} [only]
 * @returns {{ ok: true, apply: Array<{ idx: number, when: number, tag: string }> } | { ok: false, reason: string, pending?: string[] }}
 */
export function planDeploy(entries, lastCreatedAt, only = null) {
  const pending = entries.filter((e) => lastCreatedAt === null || Number(lastCreatedAt) < e.when);
  if (!only) {
    const obsolete = pending.filter((e) => OBSOLETE_MIGRATIONS.includes(e.tag)).map((e) => e.tag);
    if (obsolete.length) return { ok: false, reason: 'OBSOLETE_MIGRATION_PENDING', pending: pending.map((e) => e.tag) };
    return { ok: true, apply: pending };
  }
  const target = entries.find((e) => e.tag === only);
  if (!target) return { ok: false, reason: 'UNKNOWN_MIGRATION' };
  if (OBSOLETE_MIGRATIONS.includes(target.tag)) return { ok: false, reason: 'OBSOLETE_MIGRATION_REFUSED' };
  if (lastCreatedAt === null) return { ok: false, reason: 'EMPTY_DATABASE' };
  if (!pending.some((e) => e.tag === only)) return { ok: false, reason: 'ALREADY_APPLIED' };
  const before = pending.filter((e) => e.when < target.when && !OBSOLETE_MIGRATIONS.includes(e.tag)).map((e) => e.tag);
  if (before.length) return { ok: false, reason: 'EARLIER_MIGRATION_PENDING', pending: before };
  return { ok: true, apply: [target] };
}

/**
 * Applies exactly one journal migration, as drizzle would (statements split on its breakpoint marker, then its journal row), in ONE transaction, after
 * planDeploy() agreed under an advisory lock. Used by --only and by the LAB rehearsal (scripts/lab/r43-notice-migration-rehearsal.mjs).
 * @param {import('pg').Client} client @param {string} migrationsFolder @param {string} tag @param {{ dryRun?: boolean }} [opts]
 */
export async function applyOnly(client, migrationsFolder, tag, { dryRun = false } = {}) {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')).entries;
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('ada:db-deploy-migrate', 0))`);
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    const last = (await client.query('SELECT max(created_at)::text AS last FROM drizzle.__drizzle_migrations')).rows[0].last;
    const plan = planDeploy(journal, last === null ? null : Number(last), tag);
    if (!plan.ok || dryRun) { await client.query('ROLLBACK'); return { ...plan, dryRun }; }
    const entry = plan.apply[0];
    const text = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    for (const stmt of text.split('--> statement-breakpoint')) if (stmt.trim()) await client.query(stmt);
    await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [crypto.createHash('sha256').update(text).digest('hex'), entry.when]);
    await client.query('COMMIT');
    return { ok: true, applied: entry.tag };
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
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  const t = targetOf(url);
  if (!t.ok) { console.error(`DB_DEPLOY_MIGRATE {"ok":false,"reason":"${t.reason}"}`); process.exit(2); }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    const id = (await client.query(`select current_database() as db, current_setting('server_version') as version, inet_server_addr() is not null as remote`)).rows[0];
    console.log(`DB_TARGET ${JSON.stringify({ region: t.region, database: id.db, postgres: id.version })}`);
    const folder = path.join(ROOT, 'drizzle');
    if (only !== null) {
      if (!only) { console.error('DB_DEPLOY_MIGRATE {"ok":false,"reason":"ONLY_NEEDS_A_TAG"}'); process.exit(2); }
      const out = await applyOnly(client, folder, only, { dryRun });
      console.log(`DB_DEPLOY_MIGRATE_ONLY ${JSON.stringify(out)}`);
      if (!out.ok) process.exitCode = 3;
    } else if (!check) {
      const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')).entries;
      const last = await client.query('SELECT max(created_at)::text AS last FROM drizzle.__drizzle_migrations').then((r) => r.rows[0].last).catch(() => null);
      const plan = planDeploy(journal, last === null ? null : Number(last));
      if (!plan.ok) { console.error(`DB_DEPLOY_MIGRATE ${JSON.stringify(plan)}`); process.exit(3); }
      if (dryRun) { console.log(`DB_DEPLOY_MIGRATE_PLAN ${JSON.stringify(plan.apply.map((e) => e.tag))}`); return; }
      for (const e of EXTENSIONS) await client.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
      await migrate(drizzle(client), { migrationsFolder: folder });
    }
    const ext = (await client.query(`select extname, extversion from pg_extension where extname = any($1) order by extname`, [EXTENSIONS])).rows;
    const applied = await client.query(`select count(*)::int as n, max(created_at) as last from drizzle.__drizzle_migrations`).then((r) => r.rows[0]).catch(() => ({ n: 0, last: null }));
    const tables = (await client.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public'`)).rows[0].n;
    console.log(`DB_DEPLOY_MIGRATE ${JSON.stringify({ ok: true, mode: check ? 'check' : 'migrate', extensions: ext, migrationsApplied: applied.n, publicTables: tables })}`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`DB_DEPLOY_MIGRATE {"ok":false,"error":${JSON.stringify(String(e?.code || e?.message || e).slice(0, 200))}}`); process.exit(1); });
}
