// R47 quality: runs e2e-r47/quality/crawl.pw.mjs (kept outside e2e/, whose specs are the pinned mock QA inventory, and not named *.spec / *.test so the unit
// runner never collects it) against an already served LAB build (scripts/lab-server.mjs on 127.0.0.1:5195, synthetic database) — never starts a server,
// never uses :3000. R47Q_WORKERS (default 3) parallel browsers.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /crawl\.pw\.mjs/, workers: Number(process.env.R47Q_WORKERS || 3), fullyParallel: true, retries: 0, timeout: 600000, reporter: 'line',
  outputDir: process.env.R47Q_OUT ? `${process.env.R47Q_OUT}/pw-output` : undefined, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
