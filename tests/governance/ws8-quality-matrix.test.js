import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const UNIT_MATRIX = [
  'api/tests/admin-security.test.js',
  'api/tests/rbac.test.js',
  'tests/unit/ws1-local-storage.test.js',
  'tests/unit/ws2-data-contract.test.js',
  'tests/unit/ws2-service-public-snapshot.test.js',
  'tests/unit/ws2-strasbourg-structures-adapter.test.js',
  'tests/unit/ws3-diagnostic-boundary.test.js',
  'tests/unit/ws3-local-rules-engine.test.js',
  'tests/unit/ws4-ai-grounding.test.js',
  'tests/unit/ws4-assistant-chat-boundary.test.js',
  'tests/unit/ws4-pii-telemetry.test.js',
  'tests/unit/ws5-accessibility-contract.test.js',
  'tests/unit/ws5-pwa-contract.test.js',
  'tests/unit/ws6-dsr-lineage.test.js',
  'tests/unit/ws7-rdv-routing.test.js',
  'tests/unit/ws7-rdv-security.test.js',
  'tests/unit/phase9-strasbourg-regression.test.js',
  'tests/unit/phase9-applicability.test.js',
  'tests/unit/phase9-search-applicability.test.js',
  'tests/unit/ws8-strict-offline.test.js',
  'tests/unit/ws8-frozen-launch-data.test.js',
];

const INTEGRATION_MATRIX = [
  'tests/integration/ws3-diagnostic-local.test.js',
  'tests/integration/ws4-assistant-local.test.js',
  'tests/integration/ws4-hybrid-retrieval-sql.test.js',
  'tests/integration/ws6-dsr-disposable-db-e2e.test.js',
  'tests/integration/ws7-user-journey-contract.test.js',
  'tests/integration/ws7-remediation-evidence.test.js',
];

const E2E_MATRIX = [
  'e2e/accessibility.spec.js',
  'e2e/ws5-accessibility-shell.spec.js',
  'e2e/ws7-full-journey.spec.js',
  'e2e/public-core.spec.js',
  'e2e/pro-flow.spec.js',
  'e2e/legal-pages.spec.js',
  'e2e/provenance-trust.spec.js',
  'e2e/ressources-navigation.spec.js',
];

const ALLOWED_SKIP_FILES = new Set([
  'e2e/cp5_prod_smoke.spec.ts',
  'tests/integration/api.test.js',
  'tests/integration/phase8-openfisca-family.test.js',
  'tests/unit/cron-security.test.js',
  'tests/unit/pipeline.test.js',
]);

const REPO_OUTPUT_RISK_FILES = new Set([
  'e2e/cp1_real.spec.ts',
  'e2e/cp1ter_header.spec.ts',
  'e2e/cp2_bonus_accessibility.spec.ts',
  'e2e/cp2_list_to_detail.spec.ts',
  'e2e/cp3_view_id_canonical.spec.ts',
  'e2e/cp4_legacy_redirects.spec.ts',
  'e2e/cp5_prod_smoke.spec.ts',
]);

function trackedTestFiles() {
  return execFileSync('git', ['ls-files', 'tests', 'e2e', 'api/tests'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /\.(?:js|mjs|cjs|ts|mts|cts|jsx|tsx)$/.test(file));
}

function skipOrOnlyHits(file) {
  const source = readFileSync(file, 'utf8');
  const hits = [];
  const regex = /\b(?:describe|it|test)\s*\.\s*(skip|only)\s*\(/g;
  let match;
  while ((match = regex.exec(source))) {
    hits.push(match[1]);
  }
  return hits;
}

describe('WS8 authoritative quality-matrix governance', () => {
  it('binds the exact cross-workstream unit, integration and browser matrix to tracked files', () => {
    for (const file of [...UNIT_MATRIX, ...INTEGRATION_MATRIX, ...E2E_MATRIX]) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it('keeps repository-output-risk browser proofs outside the authoritative WS8 matrix', () => {
    const matrix = new Set(E2E_MATRIX);
    for (const file of REPO_OUTPUT_RISK_FILES) {
      expect(matrix.has(file), file).toBe(false);
    }
  });

  it('allows no focused .only and only the frozen legacy/conditional skip set', () => {
    const observedSkips = new Set();

    for (const file of trackedTestFiles()) {
      for (const kind of skipOrOnlyHits(file)) {
        expect(kind, `${file} contains forbidden focused .only`).not.toBe('only');
        if (kind === 'skip') observedSkips.add(file);
      }
    }

    expect([...observedSkips].sort()).toEqual([...ALLOWED_SKIP_FILES].sort());
  });

  it('binds local-only runners and no-install execution semantics', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const runner = readFileSync('scripts/test-run.mjs', 'utf8');

    expect(pkg.scripts['test:unit']).toBe('vitest run tests/unit/ api/tests/');
    expect(pkg.scripts['test:integration']).toBe('node scripts/test-run.mjs tests/integration');
    expect(pkg.scripts['test:e2e']).toBe('playwright test');
    expect(pkg.scripts['security:secrets']).toBe('node scripts/security-secrets-scan.mjs');

    expect(runner).toContain("new Set(['localhost', '127.0.0.1', '::1'])");
    expect(runner).toContain("dotenvConfig({ path: '.env.test.local'");
    expect(runner).toContain("dotenvConfig({ path: '.env.test'");
    expect(runner).not.toContain("dotenvConfig({ path: '.env.local'");
    expect(runner).toContain("['--no-install', 'vitest', 'run'");
    expect(runner).toContain('DATABASE_URL_TEST');
  });

  it('requires WS8 browser matrix specs to be strict-offline capable', () => {
    const fixtureBacked = E2E_MATRIX.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes("from './fixtures.js'");
    });

    expect(fixtureBacked).toEqual(expect.arrayContaining([
      'e2e/accessibility.spec.js',
      'e2e/public-core.spec.js',
      'e2e/pro-flow.spec.js',
      'e2e/legal-pages.spec.js',
      'e2e/provenance-trust.spec.js',
      'e2e/ressources-navigation.spec.js',
    ]));

    const fixtures = readFileSync('e2e/fixtures.js', 'utf8');
    expect(fixtures).toContain('WS8_STRICT_OFFLINE');
    expect(fixtures).toContain('isWs8AllowedNetworkUrl');

    const ws5 = readFileSync('e2e/ws5-accessibility-shell.spec.js', 'utf8');
    expect(ws5).toContain("page.route('**/*'");

    const ws7 = readFileSync('e2e/ws7-full-journey.spec.js', 'utf8');
    expect(ws7).toContain("page.route('**/*'");
    expect(ws7).toContain('isWs8AllowedNetworkUrl');
  });

  it('keeps direct Playwright request contexts out of the authoritative WS8 E2E matrix', () => {
    for (const file of E2E_MATRIX) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\brequest\.newContext\s*\(/);
    }
  });
});

export const WS8_AUTHORITATIVE_MATRIX = Object.freeze({
  unit: UNIT_MATRIX,
  integration: INTEGRATION_MATRIX,
  e2e: E2E_MATRIX,
});
