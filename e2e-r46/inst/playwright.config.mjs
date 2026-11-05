// R46 / inst: runs e2e-r46/inst/*.pw.mjs (kept outside e2e/, the pinned mock QA inventory, and not named *.spec / *.test so the unit runner never collects
// them) against an already served LAB build with the REAL API (R46_BASE, default http://127.0.0.1:5184) — never starts a server, never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 90000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
