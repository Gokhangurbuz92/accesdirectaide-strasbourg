// FA-D1: runs e2e-fa1/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects them) against
// the servers started by e2e-fa1/run-lab.mjs (built app + REAL api/index.js on 127.0.0.1:5196 / :5197, never :3000). One worker, files in name order (golden, then
// personas): they share one LAB database, each with its own synthetic people. The application's API is never mocked; page.route is used ONLY to simulate a network loss (route.abort).
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: 1, fullyParallel: false, retries: 0, timeout: 240000, expect: { timeout: 20000 },
  outputDir: process.env.FA1_OUT || '../test-results/fa1', reporter: process.env.FA1_REPORT ? [['list'], ['json', { outputFile: process.env.FA1_REPORT }]] : 'list',
  use: { actionTimeout: 20000, navigationTimeout: 30000, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
