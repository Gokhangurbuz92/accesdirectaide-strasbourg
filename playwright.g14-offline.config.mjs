// G14-LITE offline Mon Parcours: runs e2e-g14/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner
// never collects them) against a production build served by e2e-g14/serve-dist.mjs (started here on G14_PORT, default 5246 — never :3000). Service workers
// are ALLOWED (the spec tests the worker). The citizen API is answered by the spec itself (context routes): synthetic data only.
import { defineConfig, devices } from '@playwright/test';
const PORT = Number(process.env.G14_PORT || 5246);
export default defineConfig({
  testDir: './e2e-g14', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 120000, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, serviceWorkers: 'allow' },
  webServer: { command: `node e2e-g14/serve-dist.mjs`, url: `http://127.0.0.1:${PORT}/offline.html`, reuseExistingServer: false, env: { G14_PORT: String(PORT), G14_DIST: process.env.G14_DIST || 'dist' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
