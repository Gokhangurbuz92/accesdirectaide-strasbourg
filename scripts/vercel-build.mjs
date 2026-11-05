#!/usr/bin/env node

/**
 * Vercel build entrypoint (safe).
 *
 * Goals:
 * - Keep `npm run build` unchanged for local dev (vite build + prerender + sitemap).
 * - On Vercel: run `vite build` always. Only run prerender + sitemap on PRODUCTION
 *   (preview/branch deployments skip SSR prerender to avoid build timeouts).
 * - Run Drizzle schema push automatically in **production only**.
 * - Never print environment values (DB URLs, tokens, DSNs, etc).
 *
 * Expected Vercel setup:
 * - Build Command: `npm run build:vercel` (not « vercel-build »: @vercel/node runs a script of that name once per function under api/)
 */

import { execSync } from 'node:child_process';

/**
 * @param {string} cmd
 */
function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

const vercelEnv = String(process.env.VERCEL_ENV || '').trim() || 'unknown';
const isProduction = vercelEnv === 'production';

console.log(`[vercel-build] start (VERCEL_ENV=${vercelEnv})`);

// Schema migrations are never run by the build (there is no migration workflow): the owner applies them with scripts/db-deploy-migrate.mjs
// (obsolete 0043/0044 never applied; drizzle-kit migrate / push are refused against a non-local database by drizzle.config.ts).
// Do NOT run drizzle-kit push or migrate here.

// Step 0 (owner directive 29/10/2026): a production build runs the release gate first; any FAIL stops the build, so nothing is published.
if (isProduction) run('node scripts/release-preflight.mjs');

// Step 0b (R45, ENG-LR-4/5): the legal publisher configuration and draft documents are checked in EVERY Vercel environment (never prints a value):
// unknown publisher mode, a domicile without the owner's separate approval, a draft shown in Production or an address in the legal defaults stop the build.
run('node scripts/check-legal-publisher.mjs');

// Step 1: Build the frontend bundle (always).
run('npx vite build');

// Step 2: SSR prerender + sitemap (opt-in via ENABLE_PRERENDER=1).
// DISABLED BY DEFAULT: prerender takes 30+ minutes on Vercel, hitting the
// 45-minute build limit. Re-enable once production is stable by setting
// ENABLE_PRERENDER=1 in Vercel environment variables.
const enablePrerender = process.env.ENABLE_PRERENDER === '1';
if (isProduction && enablePrerender) {
  console.log('[vercel-build] production + ENABLE_PRERENDER=1 -> running SSR prerender + sitemap');
  try {
    run('NODE_NO_WARNINGS=1 npx tsx scripts/prerender.mjs');
  } catch (err) {
    console.warn('[vercel-build] prerender failed (non-fatal):', err.message);
  }
  try {
    run('NODE_NO_WARNINGS=1 npx tsx scripts/generate-sitemap.mjs');
  } catch (err) {
    console.warn('[vercel-build] sitemap generation failed (non-fatal):', err.message);
  }
} else {
  console.log(`[vercel-build] skipping prerender (env=${vercelEnv}, prerender=${enablePrerender})`);
}

console.log('[vercel-build] done');
