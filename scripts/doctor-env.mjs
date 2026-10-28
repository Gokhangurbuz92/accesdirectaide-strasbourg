#!/usr/bin/env node

import path from 'node:path';
import net from 'node:net';
import { config as dotenvConfig } from 'dotenv';
import { checkEnvContract } from './env-check.mjs';

const rootDir = process.cwd();

dotenvConfig({ path: path.join(rootDir, '.env.local'), override: false, quiet: true });
dotenvConfig({ path: path.join(rootDir, '.env'), override: false, quiet: true });

const lines = [];
const issues = [];
const warnings = [];

function addLine(text = '') {
  lines.push(text);
}

/**
 * @param {string} name
 * @param {string[]=} aliases
 */
function hasEnv(name, aliases = []) {
  const keys = [name, ...aliases];
  for (const key of keys) {
    const raw = process.env[key];
    if (typeof raw === 'string' && raw.trim() !== '') return true;
  }
  return false;
}

function isLikelyPlaceholderToken(value, expected) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  const byExpected =
    expected === 'user'
      ? ['user', 'username']
      : expected === 'password'
        ? ['password', 'pass']
        : ['host'];

  if (normalized.includes('...')) return true;
  if (/^<.+>$/.test(normalized)) return true;
  if (normalized.startsWith('your-') || normalized.startsWith('your_')) return true;
  if (normalized.includes('placeholder') || normalized.includes('replace-me')) return true;

  return byExpected.includes(normalized);
}

function parseDbUrl(varName, rawValue) {
  if (!rawValue) {
    issues.push(`${varName} is missing.`);
    return null;
  }

  if (rawValue.includes('...')) {
    issues.push(`${varName} contains "..." placeholder segments.`);
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    issues.push(`${varName} is not a valid URL.`);
    addLine(`- ${varName}: invalid URL`);
    return null;
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    issues.push(`${varName} must use postgresql:// (current protocol: ${parsed.protocol}).`);
  }

  const username = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');
  const host = parsed.hostname || '';
  const port = parsed.port || '5432';
  const dbname = parsed.pathname.replace(/^\//, '');
  const hasUser = Boolean(username);

  if (!hasUser) {
    issues.push(`${varName} has no database user in URL.`);
  }
  if (isLikelyPlaceholderToken(username, 'user')) {
    issues.push(`${varName} has a placeholder user.`);
  }
  if (isLikelyPlaceholderToken(password, 'password')) {
    issues.push(`${varName} has a placeholder password.`);
  }
  if (isLikelyPlaceholderToken(host, 'host')) {
    issues.push(`${varName} has a placeholder host.`);
  }
  if (!dbname) {
    issues.push(`${varName} has no dbname in URL path.`);
  }
  if (rawValue.includes('?...sslmode=') || rawValue.includes('&...sslmode=')) {
    issues.push(`${varName} has invalid sslmode query key ("...sslmode"). Use "sslmode=require".`);
  }

  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  if (!isLocalhost && !parsed.searchParams.get('sslmode')) {
    warnings.push(`${varName} has no sslmode; for managed Postgres set sslmode=require.`);
  }

  // Never print raw URL / host / db / user. Diagnostics are names-only.
  addLine(`- ${varName}: parsed`);

  return { varName, host, port: Number(port) };
}

function checkRequiredEnv() {
  const envChecks = [
    { name: 'DATABASE_URL', required: true, warnOnly: false },
    { name: 'POSTGRES_URL_NON_POOLING', aliases: ['DATABASE_URL_UNPOOLED'], required: true, warnOnly: false },
    { name: 'JWT_SECRET', required: true, warnOnly: false },
    { name: 'ADA_ENCRYPTION_KEY', required: true, warnOnly: false },

    // Optional in local: enable extra features (cron/admin/kv/storage/sentry/ai)
    { name: 'ADMIN_TOKEN', required: false, warnOnly: true },
    { name: 'CRON_SECRET', required: false, warnOnly: true },
    { name: 'DATA_AIDES_STALE_DAYS', required: false, warnOnly: true },
    { name: 'DATA_DEMARCHES_STALE_DAYS', required: false, warnOnly: true },
    { name: 'DATA_STRUCTURES_STALE_DAYS', required: false, warnOnly: true },
    { name: 'DATA_REVIEW_SCAN_LIMIT_PER_TYPE', required: false, warnOnly: true },
    { name: 'DATA_REVIEW_SCAN_CRON_LIMIT_PER_TYPE', required: false, warnOnly: true },
    { name: 'DATA_REVIEW_SCAN_CRON_ENABLED', required: false, warnOnly: true },
    { name: 'MONITOR_DQ_OPEN_TOTAL_MAX', required: false, warnOnly: true },
    { name: 'MONITOR_DQ_OPEN_P0_MAX', required: false, warnOnly: true },
    { name: 'MONITOR_INGEST_FRESHNESS_MAX_AGE_HOURS', required: false, warnOnly: true },
    { name: 'KV_REST_API_URL', required: false, warnOnly: true },
    { name: 'KV_REST_API_TOKEN', required: false, warnOnly: true },
    { name: 'STORAGE_ENDPOINT', required: false, warnOnly: true },
    { name: 'STORAGE_BUCKET', required: false, warnOnly: true },
    { name: 'STORAGE_ACCESS_KEY_ID', required: false, warnOnly: true },
    { name: 'STORAGE_SECRET_ACCESS_KEY', required: false, warnOnly: true },
    { name: 'SENTRY_DSN', required: false, warnOnly: true },
    { name: 'VITE_SENTRY_DSN', required: false, warnOnly: true },
    { name: 'GEMINI_API_KEY', required: false, warnOnly: true },
  ];

  addLine('Required variables');
  for (const item of envChecks) {
    const hasValue = hasEnv(item.name, item.aliases || []);
    let status = 'present';
    if (!hasValue && item.required) status = 'missing';
    if (!hasValue && !item.required && item.warnOnly) status = 'warn-missing';
    if (!hasValue && !item.required && !item.warnOnly) status = 'optional-missing';

    addLine(`- ${item.name}: ${status}`);

    if (item.required && !hasValue) {
      issues.push(`${item.name} is required but missing.`);
    }
    if (item.warnOnly && !hasValue) {
      warnings.push(`${item.name} is missing.`);
    }
  }

  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_API_KEY) {
    warnings.push('GEMINI_API_KEY is missing but GOOGLE_API_KEY is present. This is acceptable if code falls back to GOOGLE_API_KEY.');
  }

  const contract = checkEnvContract('local');
  for (const warning of contract.warnings) {
    warnings.push(warning);
  }
}

function checkTcp(endpoint) {
  return new Promise((resolve) => {
    if (!endpoint.host || isLikelyPlaceholderToken(endpoint.host, 'host')) {
      resolve({
        ok: false,
        skipped: true,
        reason: `skipped for placeholder host in ${endpoint.varName}`,
      });
      return;
    }

    const socket = net.createConnection({
      host: endpoint.host,
      port: endpoint.port,
      timeout: 2000,
    });

    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.on('connect', () => finish({ ok: true }));
    socket.on('timeout', () => finish({ ok: false, error: 'timeout' }));
    socket.on('error', (error) => finish({ ok: false, error: error.code || 'error' }));
  });
}

async function main() {
  addLine('AccesDirectAide local environment doctor');
  addLine('');
  checkRequiredEnv();

  addLine('');
  addLine('Database URL diagnostics');
  const dbUrls = [
    { name: 'DATABASE_URL', aliases: [] },
    { name: 'POSTGRES_URL_NON_POOLING', aliases: ['DATABASE_URL_UNPOOLED'] },
  ];
  const parsed = dbUrls
    .map((item) => {
      const keys = [item.name, ...(item.aliases || [])];
      for (const key of keys) {
        const raw = process.env[key];
        if (typeof raw === 'string' && raw.trim() !== '') {
          return parseDbUrl(item.name, raw.trim());
        }
      }
      return null;
    })
    .filter(Boolean);

  if (!parsed.length) {
    issues.push('No database URL found. Define DATABASE_URL and POSTGRES_URL_NON_POOLING.');
    addLine('- No database URL available to parse.');
  }

  addLine('');
  addLine('TCP connectivity');
  if (!parsed.length) {
    addLine('- skipped: no valid endpoints');
  } else {
    for (const endpoint of parsed) {
      const result = await checkTcp(endpoint);
      if (result.ok) {
        addLine(`- ${endpoint.varName}: reachable`);
      } else if (result.skipped) {
        addLine(`- ${endpoint.varName}: ${result.reason}`);
      } else {
        addLine(`- ${endpoint.varName}: not reachable (${result.error})`);
        issues.push(`TCP connectivity failed for ${endpoint.varName}: ${result.error}.`);
      }
    }
  }

  addLine('');
  if (warnings.length) {
    addLine('Warnings');
    for (const warning of warnings) {
      addLine(`- ${warning}`);
    }
    addLine('');
  }

  if (issues.length) {
    addLine('RESULT: KO');
    addLine('Actionable reasons');
    for (const issue of issues) {
      addLine(`- ${issue}`);
    }
    addLine('- Run: vercel env pull .env.local');
    addLine('- Run: npm run env:check');
    addLine('- Re-run: npm run doctor');
    console.log(lines.join('\n'));
    process.exit(1);
  }

  addLine('RESULT: OK');
  addLine('Your local environment is ready for migrate/seed.');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(`doctor-env failed: ${error.message}`);
  process.exit(1);
});
