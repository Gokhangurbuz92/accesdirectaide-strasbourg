// R43-A11Y: runs e2e-r43/r43-forms-a11y.spec.js (kept outside e2e/, whose every spec is the pinned mock QA inventory) against an already served build
// (R43_BASE, e.g. vite preview on :5183); never starts a server, never uses :3000
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e-r43', testMatch: /r43-forms-a11y\.spec\.js/, workers: 1, retries: 0, timeout: 90000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
