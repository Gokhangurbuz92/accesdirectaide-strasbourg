// R46 booking worker — re-runs selected specs of the pinned mock suite (e2e/, unchanged) with the system Chrome against an already served Vite dev
// server on 127.0.0.1:5183 (USE_MOCKS=true). Run: USE_MOCKS=true npx playwright test -c e2e-r46/booking/mock-regression.config.mjs <spec names>
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '../../e2e', workers: 2, retries: 0, timeout: 60000, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:5183', actionTimeout: 10000, navigationTimeout: 15000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
