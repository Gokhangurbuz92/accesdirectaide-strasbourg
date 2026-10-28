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
 * - Build Command: `npm run vercel-build`
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

// Schema migrations are handled separately via the db-migrate-deploy workflow.
// Do NOT run drizzle-kit push here — it requires interactive confirmation and
// should never run automatically during builds.

// Step 0 (owner directive 29/10/2026): a production build runs the release gate first; any FAIL stops the build, so nothing is published.
if (isProduction) run('node scripts/release-preflight.mjs');

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
