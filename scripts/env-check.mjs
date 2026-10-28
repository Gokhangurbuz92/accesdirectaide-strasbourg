#!/usr/bin/env node

/**
 * Environment contract checker (names only, no values).
 *
 * - Prints only variable NAMES and statuses (OK/MISSING/WARN).
 * - Never prints raw env values (tokens, URLs, DSNs, etc).
 * - Supports aliases (Upstash / legacy names).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function normalizeEnvValue(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value ? value : undefined;
}

function loadDotEnvFiles() {
  const rootDir = process.cwd();
  const envLocal = path.join(rootDir, '.env.local');
  const envDot = path.join(rootDir, '.env');

  // Never override process.env, only fill missing keys.
  if (fs.existsSync(envLocal)) dotenvConfig({ path: envLocal, override: false, quiet: true });
  if (fs.existsSync(envDot)) dotenvConfig({ path: envDot, override: false, quiet: true });
}

/**
 * @param {string | undefined} mode
 * @returns {'local' | 'preview' | 'prod'}
 */
export function normalizeMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  if (raw === 'prod' || raw === 'production') return 'prod';
  if (raw === 'preview') return 'preview';
  return 'local';
}

/**
 * @returns {'local' | 'preview' | 'prod'}
 */
export function inferModeFromEnv() {
  const vercel = normalizeEnvValue(process.env.VERCEL_ENV);
  if (vercel === 'production') return 'prod';
  if (vercel === 'preview') return 'preview';
  return 'local';
}

/**
 * @param {string} name
 * @param {string[]=} aliases
 * @returns {{ value: string | undefined, presentKeys: string[], conflict: boolean }}
 */
function resolveWithAliases(name, aliases = []) {
  const keys = [name, ...aliases];
  /** @type {Array<[string, string]>} */
  const present = [];

  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value != null) present.push([key, value]);
  }

  const value = present.length > 0 ? present[0][1] : undefined;

  let conflict = false;
  if (present.length > 1) {
    const firstValue = present[0][1];
    conflict = !present.every(([, v]) => v === firstValue);
  }

  return { value, presentKeys: present.map(([k]) => k), conflict };
}

/**
 * @typedef {object} EnvVarDef
 * @property {string} name
 * @property {string[]=} aliases
 */

/** @type {EnvVarDef[]} */
const REQUIRED_LOCAL = [
  { name: 'DATABASE_URL' },
  { name: 'POSTGRES_URL_NON_POOLING', aliases: ['DATABASE_URL_UNPOOLED'] },
  { name: 'JWT_SECRET' },
  { name: 'ADA_ENCRYPTION_KEY' },
];

/** @type {EnvVarDef[]} */
const REQUIRED_PREVIEW_PROD = [
  ...REQUIRED_LOCAL,

  { name: 'ADMIN_TOKEN' },
  { name: 'CRON_SECRET' },

  // Upstash/Vercel KV (Rate limiting / locks)
  {
    name: 'KV_REST_API_URL',
    aliases: ['UPSTASH_KV_REST_API_URL', 'UPSTASH_KV_KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'],
  },
  {
    name: 'KV_REST_API_TOKEN',
    aliases: ['UPSTASH_KV_REST_API_TOKEN', 'UPSTASH_KV_KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'],
  },

  // Storage (S3 compatible)
  { name: 'STORAGE_ENDPOINT' },
  { name: 'STORAGE_REGION' },
  { name: 'STORAGE_BUCKET' },
  { name: 'STORAGE_ACCESS_KEY_ID' },
  { name: 'STORAGE_SECRET_ACCESS_KEY' },

  // Observability
  { name: 'SENTRY_DSN' },
];

/**
 * @param {'local' | 'preview' | 'prod'} mode
 * @returns {EnvVarDef[]}
 */
function requiredForMode(mode) {
  if (mode === 'preview' || mode === 'prod') return REQUIRED_PREVIEW_PROD;
  return REQUIRED_LOCAL;
}

/**
 * @param {'local' | 'preview' | 'prod'} mode
 * @returns {{ ok: boolean, missing: string[], warnings: string[] }}
 */
export function checkEnvContract(mode) {
  const required = requiredForMode(mode);

  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const warnings = [];

  for (const def of required) {
    const { value, presentKeys, conflict } = resolveWithAliases(def.name, def.aliases || []);
    if (!value) missing.push(def.name);
    if (conflict) {
      warnings.push(`${def.name} multiple sources present: ${presentKeys.join(', ')}`);
    }
  }

  return { ok: missing.length === 0, missing, warnings };
}

/**
 * @param {{ mode?: 'local' | 'preview' | 'prod' }} options
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function formatEnvCheckResult(options = {}) {
  const mode = options.mode || inferModeFromEnv();
  const { ok, missing, warnings } = checkEnvContract(mode);

  /** @type {string[]} */
  const lines = [];

  if (ok) lines.push('OK');
  else lines.push(`MISSING: ${missing.join(', ')}`);

  if (warnings.length > 0) {
    lines.push(`WARN: ${warnings.join(' | ')}`);
  }

  return { exitCode: ok ? 0 : 1, lines };
}

function parseModeArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--mode' && typeof argv[i + 1] === 'string') return normalizeMode(argv[i + 1]);
    if (arg.startsWith('--mode=')) return normalizeMode(arg.slice('--mode='.length));
  }
  return null;
}

async function main() {
  loadDotEnvFiles();

  const modeFromArg = parseModeArg(process.argv.slice(2));
  const mode = modeFromArg || inferModeFromEnv();

  const { exitCode, lines } = formatEnvCheckResult({ mode });
  for (const line of lines) console.log(line);
  process.exit(exitCode);
}

const isCli = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch(() => {
    // Keep output names-only even on unexpected failures.
    console.error('MISSING: env-check failed unexpectedly');
    process.exit(1);
  });
}

