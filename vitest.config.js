import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    // Setup file runs before each test file — sets USE_MOCKS when no DB is available
    setupFiles: ['./tests/vitest.setup.js'],
    // Integration tests share a single DB — parallel file execution causes
    // race conditions (e.g. afterEach deleting all rows from Aide table).
    fileParallelism: false,
    testTimeout: 30000,
    exclude: [
      'node_modules/**',
      'dist/**',
      // Playwright E2E tests — must be run with `npx playwright test`
      'e2e/**',
      // Playwright a11y tests
      'tests/a11y/**',
      // launch-readiness item 70: tests/components/** used to be excluded here, so no component test ever ran; each such file declares
      // `// @vitest-environment jsdom` itself
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '.next/**',
        'coverage/**',
        'scripts/**',
        '*.config.*',
        'public/**',
      ],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 45,
        lines: 50,
      },
    },
  },
});
