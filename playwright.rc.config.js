// RC harness only (not for promotion): all e2e specs against a local vite server with mocks.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.(js|ts)$/,
  fullyParallel: true, retries: 0, workers: 1,
  reporter: [['json', { outputFile: 'test-results/rc.json' }]],
  use: { baseURL: 'http://127.0.0.1:31337', trace: 'off', channel: 'chrome' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ./node_modules/.bin/vite --port 31337 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:31337', reuseExistingServer: false, timeout: 60000, stdout: 'pipe',
    env: { VITE_USE_MOCKS: 'true', USE_MOCKS: 'true', ADA_STAGE6_SANDBOX: '1' },
  },
});
