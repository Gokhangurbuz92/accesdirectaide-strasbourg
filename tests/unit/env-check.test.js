import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';
import { checkEnvContract, formatEnvCheckResult } from '../../scripts/env-check.mjs';

function snapshotEnv(keys) {
  /** @type {Record<string, string | undefined>} */
  const out = {};
  for (const key of keys) out[key] = process.env[key];
  return out;
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

const MUTATED_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
  'JWT_SECRET',
  'ADA_ENCRYPTION_KEY',
  'ADMIN_TOKEN',
  'CRON_SECRET',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_KV_REST_API_URL',
  'UPSTASH_KV_REST_API_TOKEN',
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'SENTRY_DSN',
];

const ORIGINAL = snapshotEnv(MUTATED_KEYS);

afterEach(() => {
  restoreEnv(ORIGINAL);
});

describe('scripts/env-check.mjs', () => {
  it('reports missing required variables in local mode (names only)', () => {
    for (const key of MUTATED_KEYS) delete process.env[key];

    const result = checkEnvContract('local');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'JWT_SECRET', 'ADA_ENCRYPTION_KEY']);
    expect(result.warnings).toEqual([]);
  });

  it('accepts DATABASE_URL_UNPOOLED as an alias for POSTGRES_URL_NON_POOLING', () => {
    for (const key of MUTATED_KEYS) delete process.env[key];

    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://user:pass@localhost:5432/db';
    process.env.JWT_SECRET = 'jwt';
    process.env.ADA_ENCRYPTION_KEY = 'k';

    const result = checkEnvContract('local');
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('never prints env values in formatted output (even when conflicts exist)', () => {
    for (const key of MUTATED_KEYS) delete process.env[key];

    // Satisfy prod requirements with dummy values.
    process.env.DATABASE_URL = 'DATABASE_URL_VALUE_DO_NOT_PRINT';
    process.env.POSTGRES_URL_NON_POOLING = 'POSTGRES_URL_NON_POOLING_VALUE_DO_NOT_PRINT';
    process.env.JWT_SECRET = 'JWT_SECRET_VALUE_DO_NOT_PRINT';
    process.env.ADA_ENCRYPTION_KEY = 'ADA_ENCRYPTION_KEY_VALUE_DO_NOT_PRINT';
    process.env.ADMIN_TOKEN = 'ADMIN_TOKEN_VALUE_DO_NOT_PRINT';
    process.env.CRON_SECRET = 'CRON_SECRET_VALUE_DO_NOT_PRINT';
    process.env.KV_REST_API_URL = 'KV_URL_CANON_DO_NOT_PRINT';
    process.env.UPSTASH_KV_REST_API_URL = 'KV_URL_ALIAS_DO_NOT_PRINT';
    process.env.KV_REST_API_TOKEN = 'KV_TOKEN_CANON_DO_NOT_PRINT';
    process.env.UPSTASH_KV_REST_API_TOKEN = 'KV_TOKEN_ALIAS_DO_NOT_PRINT';
    process.env.STORAGE_ENDPOINT = 'STORAGE_ENDPOINT_VALUE_DO_NOT_PRINT';
    process.env.STORAGE_REGION = 'STORAGE_REGION_VALUE_DO_NOT_PRINT';
    process.env.STORAGE_BUCKET = 'STORAGE_BUCKET_VALUE_DO_NOT_PRINT';
    process.env.STORAGE_ACCESS_KEY_ID = 'STORAGE_ACCESS_KEY_ID_VALUE_DO_NOT_PRINT';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'STORAGE_SECRET_ACCESS_KEY_VALUE_DO_NOT_PRINT';
    process.env.SENTRY_DSN = 'SENTRY_DSN_VALUE_DO_NOT_PRINT';

    const { exitCode, lines } = formatEnvCheckResult({ mode: 'prod' });
    expect(exitCode).toBe(0);

    const output = lines.join('\n');
    expect(output).toContain('OK');
    expect(output).toContain('WARN:');
    expect(output).toContain('KV_REST_API_URL');
    expect(output).toContain('UPSTASH_KV_REST_API_URL');

    // Ensure none of the dummy values are leaked.
    expect(output).not.toContain('DATABASE_URL_VALUE_DO_NOT_PRINT');
    expect(output).not.toContain('KV_URL_CANON_DO_NOT_PRINT');
    expect(output).not.toContain('KV_URL_ALIAS_DO_NOT_PRINT');
    expect(output).not.toContain('SENTRY_DSN_VALUE_DO_NOT_PRINT');
  });
});

