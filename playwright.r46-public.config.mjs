// R46 public worker: runs e2e-r46/public/*.pw.mjs (outside e2e/, whose specs are the pinned mock QA inventory; not *.spec / *.test so the unit runner never
// collects them) against an already served LAB app with the real API router (e2e-r46/public/serve-lab.mjs, R46_BASE default http://127.0.0.1:5181) — it
// never starts a server and never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e-r46/public', testMatch: /\.pw\.mjs$/, workers: 1, retries: 0, timeout: 120000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
