// R46 booking worker — its own browser suite (kept outside e2e/, whose inventory is pinned). Mock API (page.route), Vite dev server on 127.0.0.1:5183
// (never :3000). Run: npx playwright test -c e2e-r46/booking/playwright.config.mjs
import { defineConfig, devices } from '@playwright/test';
const BASE = 'http://127.0.0.1:5183';
export default defineConfig({
  testDir: '.', testMatch: /r46-.*\.pw\.mjs/, workers: 1, retries: 0, timeout: 90000, reporter: 'list',
  use: { baseURL: BASE, actionTimeout: 15000, navigationTimeout: 30000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: { command: 'npx vite --port 5183 --strictPort --host 127.0.0.1', url: BASE, reuseExistingServer: process.env.R46_REUSE_SERVER === '1', timeout: 180000, stdout: 'ignore', env: { VITE_USE_MOCKS: 'true', USE_MOCKS: 'true' } },
});
