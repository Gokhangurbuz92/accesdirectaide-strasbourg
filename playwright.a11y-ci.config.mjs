// G14-CHAN (Part B) — the CI accessibility job (.github/workflows/ci.yml « a11y »): Playwright against `vite preview` of the build in `dist` (or A11Y_DIST),
// with the API mocked in the browser (e2e/fixtures.js, USE_MOCKS=true). No secret, no database, no Production, never :3000.
// Runs the existing e2e/accessibility.spec.js and tests/a11y, and the CI slice e2e-a11y/*.pw.mjs (keyboard walk, reflow 320, 400 % zoom, text spacing,
// lang / dir + Arabic RTL, forced colours, reduced motion, hover / focus contrast) — every finding FAILS the job (no report-only mode here).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.A11Y_PORT || 5182);
if (PORT === 3000) throw new Error('playwright.a11y-ci.config.mjs: port 3000 is the owner LAB');
const BASE = `http://127.0.0.1:${PORT}`;
process.env.USE_MOCKS = 'true';   // e2e/fixtures.js mocks every API call in the browser

export default defineConfig({
  testDir: '.',
  testMatch: [/e2e\/accessibility\.spec\.js$/, /tests\/a11y\/.*\.spec\.ts$/, /e2e-a11y\/.*\.pw\.mjs$/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results/a11y-ci',
  use: { baseURL: BASE, trace: 'retain-on-failure', serviceWorkers: 'block', locale: 'fr-FR', actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.A11Y_CHANNEL ? { channel: process.env.A11Y_CHANNEL } : {}) } }],   // CI: the bundled Chromium; locally A11Y_CHANNEL=chrome may use the installed Chrome
  webServer: {
    command: `npx vite preview --outDir ${process.env.A11Y_DIST || 'dist'} --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE, reuseExistingServer: false, timeout: 120_000, stdout: 'ignore',
  },
});
