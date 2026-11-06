// R47 journeys: runs e2e-r47/journeys/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner never
// collects them) against the servers started by e2e-r47/journeys/run-lab.mjs (built app + REAL api/index.js on 127.0.0.1:5192 / :3192, never :3000).
// One worker, files in order (j1 → j5): the journeys share one LAB database. No page.route anywhere: the application's API is never mocked.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: 1, fullyParallel: false, retries: 0, timeout: 180000, expect: { timeout: 20000 },
  outputDir: process.env.R47_OUT || 'test-results/r47-journeys', reporter: process.env.R47_REPORT ? [['list'], ['json', { outputFile: process.env.R47_REPORT }]] : 'list',
  use: { actionTimeout: 20000, navigationTimeout: 30000, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
