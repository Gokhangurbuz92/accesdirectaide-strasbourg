// R46 finish: runs e2e-r46/finish/*.pw.mjs (outside e2e/, the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects them) against the
// built app served with the REAL API by e2e-r46/finish/run-lab.mjs (R46F_BASE :5187 policy pending, R46F_BASE_CONF :3187 synthetic policy). Never :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 90000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
