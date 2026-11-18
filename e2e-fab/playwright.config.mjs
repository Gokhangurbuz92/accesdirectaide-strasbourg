// FA-CAP: runs e2e-fab/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects them)
// against the servers started by e2e-fab/run-lab.mjs (built app + REAL api/index.js on 127.0.0.1:5211 / :5212 / :5213, never :3000). Files run in parallel
// (one worker each, tests of a file in order): they share one LAB database, each test with its own synthetic people / records, so no file depends on another.
// The application's API is never mocked.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: Number(process.env.FAB_WORKERS || 4), fullyParallel: false, retries: 0, timeout: 120000, expect: { timeout: 15000 },
  outputDir: process.env.FAB_OUT || '../test-results/fab', reporter: process.env.FAB_REPORT ? [['list'], ['json', { outputFile: process.env.FAB_REPORT }]] : 'list',
  use: { actionTimeout: 15000, navigationTimeout: 30000, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
