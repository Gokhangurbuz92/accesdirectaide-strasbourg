#!/usr/bin/env node

/**
 * Post-deploy smoke checks (prod).
 *
 * - No secrets are hardcoded.
 * - Never prints env values (tokens, URLs, DSNs).
 *
 * READ-ONLY by default (R47 audit): it used to call /api/cron/actualites, i.e. RUN the news ingestion in Production (external fetches, database
 * writes) under the name of a smoke test. It now reads the job's freshness (/api/monitor/cron/actualites) instead; running the job is an explicit
 * `--run-cron` (needs CRON_SECRET), never a side effect of a check.
 *
 * Usage:
 *   export PROD_URL="https://www.accesdirectaide.fr"
 *   export ADMIN_TOKEN="..."
 *   npm run smoke:prod                      # read-only
 *   CRON_SECRET="..." npm run smoke:prod -- --run-cron   # also runs the actualites job once (writes)
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

/**
 * The requests of one smoke run (pure: no network). @param {string[]} argv @param {Record<string, string | undefined>} env
 * @returns {{ missing: string[], checks: { label: string, url: string, headers?: Record<string, string> }[] }}
 */
export function smokePlan(argv, env) {
  const value = (/** @type {string} */ name) => (typeof env[name] === 'string' && String(env[name]).trim() !== '' ? String(env[name]).trim() : null);
  const baseUrl = (value('PROD_URL') || 'https://www.accesdirectaide.fr').replace(/\/+$/, '');
  const runCron = argv.includes('--run-cron');
  const cronSecret = value('CRON_SECRET');
  const adminToken = value('ADMIN_TOKEN');
  const missing = [...(adminToken ? [] : ['ADMIN_TOKEN']), ...(runCron && !cronSecret ? ['CRON_SECRET'] : [])];
  const checks = [
    { label: 'health', url: `${baseUrl}/api/health` },
    runCron
      ? { label: 'cron.actualites (run)', url: `${baseUrl}/api/cron/actualites`, headers: { Authorization: `Bearer ${cronSecret}` } }
      : { label: 'cron.actualites (freshness, read-only)', url: `${baseUrl}/api/monitor/cron/actualites` },
    { label: 'admin.cron-runs', url: `${baseUrl}/api/admin/cron-runs?limit=10`, headers: { Authorization: `Bearer ${adminToken}` } },
  ];
  return { missing, checks };
}

async function main() {
  const { missing, checks } = smokePlan(process.argv.slice(2), process.env);
  if (missing.length > 0) {
    console.error(`[smoke] MISSING: ${missing.join(', ')}`);
    process.exit(1);
  }
  for (const c of checks) await check(c.label, c.url, c.headers ? { headers: c.headers } : {});
  console.log('[smoke] OK');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  const status = typeof err?.statusCode === 'number' ? ` HTTP=${err.statusCode}` : '';
  console.error(`[smoke] FAILED.${status}`);
  process.exit(1);
});

