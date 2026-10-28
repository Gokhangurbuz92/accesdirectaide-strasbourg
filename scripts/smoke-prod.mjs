#!/usr/bin/env node

/**
 * Post-deploy smoke checks (prod).
 *
 * - No secrets are hardcoded.
 * - Never prints env values (tokens, URLs, DSNs).
 *
 * Usage:
 *   export PROD_URL="https://www.accesdirectaide.fr"
 *   export CRON_SECRET="..."
 *   export ADMIN_TOKEN="..."
 *   npm run smoke:prod
 */

import { fetch } from 'undici';

/**
 * @param {string} label
 * @param {string} url
 * @param {{ headers?: Record<string, string> }=} options
 */
async function check(label, url, options = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: options.headers || undefined,
  });

  // Try to capture minimal diagnostics without dumping arbitrary HTML.
  let requestId = undefined;
  try {
    const text = await res.text();
    const json = JSON.parse(text);
    if (json && typeof json === 'object' && typeof json.requestId === 'string') requestId = json.requestId;
  } catch {
    // ignore
  }

  const status = res.status;
  const ok = status >= 200 && status < 300;
  const extra = requestId ? ` requestId=${requestId}` : '';

  console.log(`[smoke] ${label}: HTTP=${status}${extra}`);
  if (!ok) {
    const err = new Error(`[smoke] ${label} failed (HTTP=${status})`);
    err.statusCode = status;
    throw err;
  }
}

function requireEnv(name) {
  const raw = process.env[name];
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return null;
}

async function main() {
  const baseUrl = requireEnv('PROD_URL') || 'https://www.accesdirectaide.fr';
  const cronSecret = requireEnv('CRON_SECRET');
  const adminToken = requireEnv('ADMIN_TOKEN');

  const missing = [];
  if (!cronSecret) missing.push('CRON_SECRET');
  if (!adminToken) missing.push('ADMIN_TOKEN');

  if (missing.length > 0) {
    console.error(`[smoke] MISSING: ${missing.join(', ')}`);
    process.exit(1);
  }

  await check('health', `${baseUrl}/api/health`);
  await check('cron.actualites', `${baseUrl}/api/cron/actualites`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  await check('admin.cron-runs', `${baseUrl}/api/admin/cron-runs?limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  console.log('[smoke] OK');
}

main().catch((err) => {
  const status = typeof err?.statusCode === 'number' ? ` HTTP=${err.statusCode}` : '';
  console.error(`[smoke] FAILED.${status}`);
  process.exit(1);
});

