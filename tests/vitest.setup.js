import { installWs8StrictOfflineNetworkGuards } from './helpers/ws8-strict-offline.js';

if (process.env.WS8_STRICT_OFFLINE === '1') {
  installWs8StrictOfflineNetworkGuards();
}

/**
 * Vitest Global Setup — Unit Test Environment
 *
 * Ensures unit tests can run without a real database connection.
 * When DATABASE_URL is not set, we set USE_MOCKS=true so that
 * src/db/index.ts creates a dummy db object instead of throwing.
 *
 * Integration tests that need a real DB should set DATABASE_URL
 * or DATABASE_URL_TEST in their environment.
 */

// Set USE_MOCKS before any module imports db/index.ts
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_TEST) {
  process.env.USE_MOCKS = 'true';
}

// Ensure required env vars for auth/env.js Zod validation don't fail
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
}
if (!process.env.ADA_ENCRYPTION_KEY) {
  process.env.ADA_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex key
}
