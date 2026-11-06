// R47 admin: runs e2e-r47/admin/r47-admin-journeys.pw.mjs (outside e2e/, the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects
// it) against e2e-r47/admin/serve.mjs already listening on 127.0.0.1:5193 — never starts a server, never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /r47-admin-journeys\.pw\.mjs/, workers: 1, retries: 0, timeout: 120000, reporter: 'list', outputDir: '../../test-results-r47',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', locale: 'fr-FR' } }] });
