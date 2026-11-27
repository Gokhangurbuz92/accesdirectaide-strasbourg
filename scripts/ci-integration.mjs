#!/usr/bin/env node
// A10 (27/11/2026) — the tests/integration suite against a THROWAWAY local PostgreSQL (CI service container or a scratch cluster).
// Refuses any database that is not postgresql:// on loopback with a name ending in _test (the same rule as the native QA's gated suites).
// Steps: extensions (unaccent, pg_trgm, vector) + UTC → every drizzle migration → vitest tests/integration with the native QA's synthetic environment.
// Left to the native QA (they need what CI does not have): ws6 (its own disposable database) and ws2-local-seed (a local Ollama model).
// Usage: DATABASE_URL=postgresql://postgres@127.0.0.1:5432/ada_ci_int_test [PG_BIN=/usr/lib/postgresql/17/bin] node scripts/ci-integration.mjs [--check-only]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

export const NATIVE_QA_ONLY = ['tests/integration/ws6-dsr-disposable-db-e2e.test.js', 'tests/integration/ws2-local-seed.test.js'];

/** @param {string | undefined} url */
export function ciDatabaseRefusal(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return 'DATABASE_URL missing or not a URL'; }
  if (u.protocol !== 'postgresql:') return 'DATABASE_URL must use postgresql://';
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return 'DATABASE_URL must be on loopback (a throwaway local database)';
  if (u.password) return 'DATABASE_URL must not carry a password (trust auth on a throwaway database)';
  if (u.search) return 'DATABASE_URL must not carry query parameters';
  if (!/(^|_)test$/.test(u.pathname.replace(/^\//, ''))) return 'the database name must end in _test';
  return null;
}

/** synthetic values only — the same profile as the native QA's integration stage (test_env(compat=True) + integration_env) */
export function integrationEnv(url, storageDir) {
  const zeros = '0'.repeat(64);
  return {
    TZ: 'UTC', NODE_ENV: 'test', VERCEL_ENV: 'development', ADA_PUBLIC_CONTENT_MODE: 'lab',
    JWT_SECRET: 'test-jwt-secret', ADA_ENCRYPTION_KEY: zeros, OUTLOOK_TOKEN_ENCRYPTION_KEY: '1'.repeat(64), AUTH_SECRET: '2'.repeat(64),
    CRON_SECRET: 'test-cron-secret', ADMIN_TOKEN: 'test-admin-token', BYPASS_SECRET: 'test-bypass-secret',
    STORAGE_ENDPOINT: 'http://localhost:9000', STORAGE_BUCKET: 'test-bucket', STORAGE_ACCESS_KEY_ID: 'test-access-key',
    STORAGE_SECRET_ACCESS_KEY: 'test-secret-key', STORAGE_PUBLIC_URL: 'http://localhost:9000/test-bucket', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
    KV_REST_API_URL: 'http://localhost', UPSTASH_KV_KV_REST_API_URL: 'http://localhost', UPSTASH_REDIS_REST_URL: 'http://localhost',
    KV_REST_API_TOKEN: 'dummy', UPSTASH_KV_KV_REST_API_TOKEN: 'dummy', UPSTASH_REDIS_REST_TOKEN: 'dummy',
    DATABASE_URL: url, DATABASE_URL_TEST: url, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url, DATABASE_URL_UNPOOLED: url,
    WS4_HYBRID_SQL_TEST_URL: url, WS4_TERRITORY_SQL_TEST_URL: url, WS2_REQUIRE_LOCAL_DB: '1',
    ADA_LOCAL_STORAGE_DIR: storageDir,   // outside the checkout: LocalFilesystemStorage refuses a root inside a Git worktree
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  const refusal = ciDatabaseRefusal(url);
  if (refusal) { console.error(`ci-integration refused: ${refusal}`); process.exit(2); }
  if (process.argv.includes('--check-only')) { console.log('ci-integration: database accepted'); return; }

  const name = new URL(url).pathname.slice(1);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
    await c.query(`ALTER DATABASE "${name.replace(/"/g, '')}" SET timezone TO 'UTC'`);
  } finally { await c.end(); }

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-int-storage-'));
  fs.chmodSync(storageDir, 0o700);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', ...(process.env.PG_BIN ? { PG_BIN: process.env.PG_BIN } : {}), ...integrationEnv(url, storageDir) };
  const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', env }).status ?? 1;

  // drizzle.config.ts itself refuses `migrate` against any non-local database (scripts/db-migrate-guard.mjs)
  if (run('npx', ['--no-install', 'drizzle-kit', 'migrate']) !== 0) { console.error('ci-integration: migrations failed'); process.exit(1); }
  const excludes = NATIVE_QA_ONLY.flatMap((f) => ['--exclude', f]);
  process.exit(run('npx', ['--no-install', 'vitest', 'run', 'tests/integration', ...excludes]));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`ci-integration: ${e?.message || e}`); process.exit(1); });
