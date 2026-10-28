import { spawnSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import pg from 'pg';

function npxCmd() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function safeExit(message, code = 1) {
  // Intentionally avoid printing any secret values (URLs/tokens).
  console.error(message);
  process.exit(code);
}

function validateTestDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    safeExit('[test-run] DATABASE_URL_TEST must be a valid URL (postgresql://...).');
  }

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    safeExit('[test-run] DATABASE_URL_TEST must use the postgresql:// protocol.');
  }

  const host = (url.hostname || '').toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!allowedHosts.has(host)) {
    safeExit('[test-run] Refusing to run against a non-local database host. Use localhost/127.0.0.1/::1.');
  }

  const dbName = (url.pathname || '').replace(/^\//, '');
  if (!dbName) {
    safeExit('[test-run] DATABASE_URL_TEST must include a database name.');
  }

  // Basic guard rail to avoid wiping a developer/prod DB by mistake.
  if (!/test/i.test(dbName)) {
    safeExit('[test-run] Refusing to reset a database whose name does not include "test".');
  }
}

function buildTestEnv() {
  // Load dedicated test env files only (never .env.local).
  dotenvConfig({ path: '.env.test.local', override: false, quiet: true });
  dotenvConfig({ path: '.env.test', override: false, quiet: true });

  let databaseUrlTest = process.env.DATABASE_URL_TEST;
  if (!databaseUrlTest) {
    // When SKIP_DB_SETUP is set, the DB is never actually used.
    // Provide a safe dummy URL to avoid blocking CI/unit-only test runs.
    if (process.env.SKIP_DB_SETUP) {
      databaseUrlTest = 'postgresql://ci@localhost:5432/acces_direct_aide_test?schema=public';
      console.log('[test-run] No DATABASE_URL_TEST but SKIP_DB_SETUP is set — using dummy URL.');
    } else {
      safeExit(
        [
          '[test-run] Missing DATABASE_URL_TEST.',
          'Set it in your shell or in .env.test.local (gitignored).',
          'Example: DATABASE_URL_TEST="postgresql://USER@localhost:5432/acces_direct_aide_test?schema=public"',
        ].join('\n'),
      );
    }
  }

  validateTestDatabaseUrl(databaseUrlTest);

  // Force non-production runtime flags for deterministic tests.
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    VERCEL_ENV: 'test',
    TZ: 'UTC',

    // Prisma datasource (force test DB)
    DATABASE_URL: databaseUrlTest,
    DATABASE_URL_TEST: databaseUrlTest,
    POSTGRES_PRISMA_URL: databaseUrlTest,
    POSTGRES_URL_NON_POOLING: databaseUrlTest,
    DATABASE_URL_UNPOOLED: databaseUrlTest,

    // Never talk to external KV/Upstash during unit/integration tests.
    KV_REST_API_URL: 'http://localhost',
    KV_REST_API_TOKEN: 'dummy',
    UPSTASH_KV_KV_REST_API_URL: 'http://localhost',
    UPSTASH_KV_KV_REST_API_TOKEN: 'dummy',
    UPSTASH_REDIS_REST_URL: 'http://localhost',
    UPSTASH_REDIS_REST_TOKEN: 'dummy',
  };

  // Provide safe defaults for required secrets in test mode.
  // These are NOT production secrets and must remain non-sensitive.
  env.JWT_SECRET ||= 'test-jwt-secret';
  env.ADA_ENCRYPTION_KEY ||= '0'.repeat(64); // 32 bytes hex
  env.CRON_SECRET ||= 'test-cron-secret';
  env.ADMIN_TOKEN ||= 'test-admin-token';
  env.BYPASS_SECRET ||= 'test-bypass-secret';

  // Dummy Storage config
  env.STORAGE_ENDPOINT ||= 'http://localhost:9000';
  env.STORAGE_BUCKET ||= 'test-bucket';
  env.STORAGE_ACCESS_KEY_ID ||= 'test-access-key';
  env.STORAGE_SECRET_ACCESS_KEY ||= 'test-secret-key';
  env.STORAGE_PUBLIC_URL ||= 'http://localhost:9000/test-bucket';

  return env;
}

async function ensureRequiredPgExtensions(env) {
  const { Client } = pg;
  const client = new Client({ connectionString: env.DATABASE_URL_TEST });

  try {
    await client.connect();
  } catch {
    safeExit(`[test-run] Cannot connect to DATABASE_URL_TEST (is your local Postgres running?).`);
  }

  try {
    // Reset schema deterministically.
    // Note: dropping `public` also drops extensions installed there, so we recreate extensions below.
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await client.query('CREATE SCHEMA public;');

    // Required by search + schema (pgvector).
    await client.query('CREATE EXTENSION IF NOT EXISTS unaccent;');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
  } catch {
    safeExit(
      [
        '[test-run] Failed to reset test DB or install required extensions.',
        '- Ensure pgvector is installed and available (extension: vector).',
        '- CI uses a pgvector-enabled Postgres image; locally you can install pgvector or use a container.',
      ].join('\n'),
    );
  } finally {
    await client.end().catch(() => { });
  }
}

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    safeExit(`[test-run] Failed to run ${cmd}: ${String(result.error.message || result.error)}`);
  }

  return result.status ?? 1;
}

const env = buildTestEnv();

// 1) Deterministic DB reset (schema from Drizzle + seed).
if (!process.env.SKIP_DB_SETUP) {
  await ensureRequiredPgExtensions(env);
  const prismaStatus = run(npxCmd(), ['--no-install', 'drizzle-kit', 'push', '--force'], env);
  if (prismaStatus !== 0) process.exit(prismaStatus);

  // const seedStatus = run(process.execPath, ['prisma/seed.js'], env);
  // if (seedStatus !== 0) process.exit(seedStatus);
} else {
  console.log('[test-run] Skipping DB setup (SKIP_DB_SETUP=1). Tests requiring DB will fail.');
}

// 2) Run Vitest (forward extra args).
const vitestArgs = process.argv.slice(2);
const vitestStatus = run(npxCmd(), ['--no-install', 'vitest', 'run', ...vitestArgs], env);
process.exit(vitestStatus);
