// R44-BOOK: runs e2e-r44/r44-booking-journey.pw.mjs (kept outside e2e/, whose every spec is the pinned mock QA inventory, and not named *.spec / *.test so the
// unit runner never collects it) against an already served LAB build (R44_BASE, 127.0.0.1:5185; API 127.0.0.1:31412) — never starts a server, never uses :3000.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e-r44', testMatch: /r44-booking-journey\.pw\.mjs/, workers: 1, retries: 0, timeout: 120000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
