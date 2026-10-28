#!/usr/bin/env node
/**
 * Public beta (owner directive 29/10/2026): apply the repository's Drizzle migrations to the NEW production database (Neon, Frankfurt).
 * Uses the direct (unpooled) connection — DDL and the migrator's lock do not belong on the transaction pooler — with a verified TLS certificate.
 * Refuses a loopback host, so it can never touch the local LAB database. Prints the target identity and the result, never a credential.
 *
 *   DATABASE_URL_UNPOOLED=… node scripts/db-deploy-migrate.mjs [--check]     (--check: read-only identity + schema report, no change)
 */
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

async function main() {
  const check = process.argv.includes('--check');
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  const t = targetOf(url);
  if (!t.ok) { console.error(`DB_DEPLOY_MIGRATE {"ok":false,"reason":"${t.reason}"}`); process.exit(2); }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    const id = (await client.query(`select current_database() as db, current_setting('server_version') as version, inet_server_addr() is not null as remote`)).rows[0];
    console.log(`DB_TARGET ${JSON.stringify({ region: t.region, database: id.db, postgres: id.version })}`);
    if (!check) {
      for (const e of EXTENSIONS) await client.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
      await migrate(drizzle(client), { migrationsFolder: path.join(ROOT, 'drizzle') });
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
