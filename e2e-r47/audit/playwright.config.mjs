// R47 / audit: runs e2e-r47/audit/*.pw.mjs (outside e2e/, the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects them) against an
// already served LAB build with the REAL API (R47_BASE, default http://127.0.0.1:5194) — started by e2e-r47/audit/run-lab.mjs; never :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 90000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
