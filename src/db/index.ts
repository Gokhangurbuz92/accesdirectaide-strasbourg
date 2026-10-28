/* eslint-disable no-undef */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// launch-readiness item 60: the codec of the encrypted columns (src/db/sealed-json.ts) needs the data key: loaded only where it exists — without it (or if
// it cannot load) a write to such a column FAILS instead of storing it in clear, and the rest of the database keeps working
if (process.env.ADA_ENCRYPTION_KEY) {
  try { await import('../../api/lib/situation-codec.js'); } catch { console.error('[db] encryption codec unavailable: encrypted columns refuse writes'); }
}

const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_TEST;

// In E2E / dev-preview environments (no real DB), silently skip initialization.
// The API handlers won't be called because USE_MOCKS is set.
// In all other environments (CI integration tests, production),
// crash loudly if DATABASE_URL is missing.
let db: ReturnType<typeof drizzle<typeof schema>>;

if (connectionString) {
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

  // Suppress pg v8+ SECURITY WARNING about implicit SSL modes.
  // The warning fires when sslmode is 'prefer', 'require', or 'verify-ca'
  // without 'uselibpqcompat=true'. Cloud providers (Neon, Supabase) often set
  // sslmode=require in their DATABASE_URL by default.
  let finalConnectionString = connectionString;
  if (!isLocal && !connectionString.includes('uselibpqcompat=')) {
    const separator = connectionString.includes('?') ? '&' : '?';
    if (connectionString.includes('sslmode=')) {
      // sslmode already set (e.g. Neon's ?sslmode=require) — just add compat flag
      finalConnectionString = `${connectionString}&uselibpqcompat=true`;
    } else {
      finalConnectionString = `${connectionString}${separator}sslmode=require&uselibpqcompat=true`;
    }
  }

  // Owner LAB audit: TLS to a remote database does not verify the server certificate unless DATABASE_SSL_VERIFY=true (deployment checklist: set it once the
  // provider's certificate chain has been tested — a man-in-the-middle could otherwise read the traffic). The default is unchanged so no deployment breaks silently.
  const verifyTls = process.env.DATABASE_SSL_VERIFY === 'true';
  const pool = new pg.Pool({
    connectionString: finalConnectionString,
    ssl: isLocal ? false : { rejectUnauthorized: verifyTls },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  db = drizzle(pool, { schema });
} else if (process.env.USE_MOCKS === 'true' || process.env.VITE_SKIP_DB === 'true') {
  // E2E / Storybook / dev-preview: provide a dummy that won't be used at runtime
  db = {} as ReturnType<typeof drizzle<typeof schema>>;
} else {
  throw new Error('DATABASE_URL is not set for Drizzle ORM');
}

export { db };
