import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ciDatabaseRefusal, integrationEnv, NATIVE_QA_ONLY } from '../../scripts/ci-integration.mjs';

// A10: CI runs the integration suite, but only ever against a throwaway loopback *_test database.
describe('A10 CI integration runner', () => {
  it('accepts only postgresql:// loopback *_test databases without password or query', () => {
    expect(ciDatabaseRefusal('postgresql://postgres@127.0.0.1:5432/ada_ci_int_test')).toBeNull();
    expect(ciDatabaseRefusal('postgresql://postgres@localhost:55434/x_test')).toBeNull();
    expect(ciDatabaseRefusal(undefined)).toMatch(/missing/);
    expect(ciDatabaseRefusal('postgres://postgres@127.0.0.1/ada_test')).toMatch(/postgresql/);
    expect(ciDatabaseRefusal('postgresql://u@ep-x.eu-central-1.aws.neon.tech/neondb_test')).toMatch(/loopback/);
    expect(ciDatabaseRefusal('postgresql://u:pw@127.0.0.1/ada_test')).toMatch(/password/);
    expect(ciDatabaseRefusal('postgresql://u@127.0.0.1/ada_test?sslmode=require')).toMatch(/query/);
    expect(ciDatabaseRefusal('postgresql://u@127.0.0.1/ada_lab')).toMatch(/_test/);
  });
  it('uses synthetic values only and keeps ws6 / ws2-local-seed in the native QA', () => {
    const env = integrationEnv('postgresql://postgres@127.0.0.1:5432/ada_ci_int_test', '/tmp/x');
    expect(env.ADA_PUBLIC_CONTENT_MODE).toBe('lab');
    expect(env.ADA_ENCRYPTION_KEY).toBe('0'.repeat(64));
    expect(Object.values(env).join(' ')).not.toMatch(/neon\.tech|vercel\.app|accesdirectaide\.fr/);
    expect(NATIVE_QA_ONLY).toEqual(['tests/integration/ws6-dsr-disposable-db-e2e.test.js', 'tests/integration/ws2-local-seed.test.js']);
  });
  it('the CI workflow runs it with a loopback *_test service database', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('run: node scripts/ci-integration.mjs');
    expect(ci).toContain('DATABASE_URL: postgresql://postgres@127.0.0.1:5432/ada_ci_int_test');
    expect(ci).toMatch(/MAX_DESIGN_SYSTEM_VIOLATIONS: "110"/);
  });
});
