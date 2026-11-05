// R46 citizen: runs e2e-r46/citizen/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner never collects them)
// against an already served LAB build with the REAL API (R46C_BASE, default http://127.0.0.1:5182) and the local mock FranceConnect provider. Never starts a server, never :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 120000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
