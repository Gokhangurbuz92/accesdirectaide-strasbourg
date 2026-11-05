// R46 pro: runs e2e-r46/pro/r46-pro-journeys.pw.mjs (kept outside e2e/, whose specs are the pinned mock QA inventory, and not named *.spec / *.test so the
// unit runner never collects it) against an already served LAB build (serve.mjs on 127.0.0.1:5186) and the local mock ProConnect issuer (:5197) —
// never starts a server, never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /r46-pro-journeys\.pw\.mjs/, workers: 1, retries: 0, timeout: 120000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
