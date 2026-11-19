// G4 browser-only orientation: runs e2e-g4/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner never
// collects them) against a Production-config build served by e2e-g4/serve-dist.mjs (G4_BASE default http://127.0.0.1:5231). It never starts a server and never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e-g4', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 120000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
