import { defineConfig, devices } from '@playwright/test';

const REMOTE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL; // PROD or Preview
const LOCAL_BASE_URL = 'http://127.0.0.1:3000';

// If a remote URL is provided, use it. Otherwise, assume local.
const BASE_URL = REMOTE_BASE_URL || LOCAL_BASE_URL;

// Start Vite only if:
// - CI (we want reliable local), OR
// - No remote URL is provided (so we target local)
const SHOULD_START_WEBSERVER = !!process.env.CI || !REMOTE_BASE_URL;

// Build project list: always include chromium.
// Only include integration project when a remote URL is provided —
// otherwise it duplicates smoke/vital tests against the same local mock server,
// doubling CI load for no benefit.
const projects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
];

if (REMOTE_BASE_URL) {
  projects.push({
    name: 'integration',
    use: { ...devices['Desktop Chrome'] },
    testMatch: /smoke-|vital-|aides-flow|booking/,
  });
}

export default defineConfig({
  testDir: process.env.TEST_A11Y ? './tests/a11y' : './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Increase timeouts for CI containers which may be slower
    actionTimeout: process.env.CI ? 15_000 : 10_000,
    navigationTimeout: process.env.CI ? 30_000 : 15_000,
  },

  projects,

  webServer: SHOULD_START_WEBSERVER
    ? {
      // In CI, use `vite preview` (serves pre-built dist — starts instantly).
      // Locally, use `vite` (dev server with HMR).
      command: process.env.CI
        ? 'npx vite preview --port 3000 --host 127.0.0.1'
        : 'npx vite --port 3000 --host 127.0.0.1',
      url: LOCAL_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000, // 3min for slow CI containers
      stdout: 'pipe',
      env: {
        VITE_USE_MOCKS: 'true',
        USE_MOCKS: 'true',
      },
    }
    : undefined,
});
