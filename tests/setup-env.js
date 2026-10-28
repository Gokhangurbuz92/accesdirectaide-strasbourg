// Load .env.local (DATABASE_URL etc.) before anything else
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.VERCEL_ENV = process.env.VERCEL_ENV || 'test';

// Provide safe defaults for required server secrets in test mode.
// These are NOT production secrets.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADA_ENCRYPTION_KEY = process.env.ADA_ENCRYPTION_KEY || '0'.repeat(64);
process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret';
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
process.env.BYPASS_SECRET = process.env.BYPASS_SECRET || 'test-bypass-secret';

// Ensure tests never talk to external KV/Upstash.
process.env.KV_REST_API_URL = process.env.KV_REST_API_URL || 'http://localhost';
process.env.KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || 'dummy_token';
process.env.UPSTASH_KV_KV_REST_API_URL = '';
process.env.UPSTASH_KV_KV_REST_API_TOKEN = '';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

process.env.STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT || 'http://localhost';
process.env.STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'dummy';
process.env.STORAGE_ACCESS_KEY_ID = process.env.STORAGE_ACCESS_KEY_ID || 'dummy';
process.env.STORAGE_SECRET_ACCESS_KEY = process.env.STORAGE_SECRET_ACCESS_KEY || 'dummy';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

// Silence noisy logs during tests (resilience checks, validation errors)
const originalError = console.error;
const originalWarn = console.warn;

console.error = (...args) => {
    const msg = String(args?.[0] ?? "");
    // Filter out expected errors tested in resilience suites
    if (
        msg.includes("Actualites DB Error (Recovered)") ||
        msg.includes("Unauthorized Pipeline Attempt") ||
        msg.includes("ZodError") ||
        msg.includes("SLOT_TAKEN") ||
        msg.includes("Pipeline: Ingest Structures failed")
    ) {
        return;
    }
    originalError(...args);
};

console.warn = (...args) => {
    originalWarn(...args);
};

// --- Drizzle Universal Teardown ---
import { afterEach } from 'vitest';

export async function resetDatabase() {
  // Dynamic import to avoid ESM hoisting issue (db requires DATABASE_URL at import time)
  const { db } = await import('../src/db/index.js');

  // Skip teardown if db is a dummy object (USE_MOCKS / VITE_SKIP_DB)
  if (typeof db.execute !== 'function') return;

  const { sql } = await import('drizzle-orm');

  // Récupère toutes les tables du schéma public
  const { rows: tablenames } = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`
  );

  const tables = tablenames
   .map(({ tablename }) => tablename)
   .filter((name) => name !== '__drizzle_migrations') // Protège l'historique de Drizzle Kit
   .map((name) => `"public"."${name}"`)
   .join(', ');

  try {
    if (tables.length > 0) {
      // Vide toutes les tables en cascade pour ignorer les contraintes de clés étrangères lors du nettoyage
      await db.execute(sql`TRUNCATE TABLE ${sql.raw(tables)} CASCADE;`);
    }
  } catch (error) {
    console.error('Erreur lors du nettoyage de la base de données de test:', error);
  }
}

// Hook Vitest à exécuter après chaque test
afterEach(async () => {
  // Only run teardown if we have a real DB connection (not skipped)
  if (!process.env.SKIP_DB_SETUP && (process.env.DATABASE_URL_TEST || process.env.DATABASE_URL)) {
    await resetDatabase();
  }
});
