// G14-PS browser checks: runs e2e-g14ps/*.pw.mjs against a build served by e2e-g4/serve-dist.mjs (G14PS_BASE default http://127.0.0.1:5241; no backend,
// every request recorded). The social referral pages get their API answers from page.route mocks. It never starts a server and never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e-g14ps', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 180000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', acceptDownloads: true } }] });
