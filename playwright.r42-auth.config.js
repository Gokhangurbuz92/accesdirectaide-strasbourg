// R42-AUTH: runs e2e/r42-auth-forms.spec.js against an already served build (R42_BASE); never starts a server on :3000
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: /r42-auth-forms\.spec\.js/, workers: 1, retries: 0, timeout: 90000, reporter: 'list', projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] });
