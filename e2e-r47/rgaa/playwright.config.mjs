// FA-D4: runs e2e-r47/rgaa/rgaa-audit.pw.mjs (outside e2e/, the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects it) against
// e2e-r47/admin/serve.mjs started by e2e-r47/rgaa/run.sh on 127.0.0.1 — never starts a server, never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /rgaa-audit\.pw\.mjs/, workers: 1, retries: 0, timeout: 1800000, reporter: 'list', outputDir: '../../test-results/rgaa',
  use: { actionTimeout: 15000, navigationTimeout: 30000, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', locale: 'fr-FR' } }] });
