/**
 * DTA S1D — F1 of the browser QA: /api/diagnostic imported api/lib/openfiscaClient.js at module load, and that module THROWS at import time
 * (OPENFISCA_PROTOTYPE_ENDPOINT_BLOCKED) when no OPENFISCA_URL is configured outside production => even the explicit local SIMULATION_MODE answered 500 "Server Boot Error".
 * SIMULATION_MODE never uses OpenFisca, so it must not depend on its configuration.  The client is now loaded lazily, only on the AUTHORITATIVE paths, where an unusable client
 * is reported as the existing fail-closed 503 OPENFISCA_UNAVAILABLE (never a local fallback, never a 500 with a boot message).
 * The REAL openfiscaClient module is used here (not mocked) with the offending environment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 'run-1' }] }) }), update: () => ({ set: () => ({ where: async () => [] }) }) } }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('@sentry/node', () => ({ captureException: () => {}, captureMessage: () => {}, addBreadcrumb: () => {}, withScope: (f) => f({ setExtra() {}, setTag() {} }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const ANSWERS = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { salary: 0, unemployment: 700 }, housing: { status: 'tenant', rent: 480, charges: 0 } };

describe('diagnostic handler vs. an unusable OpenFisca configuration (real client module, no OPENFISCA_URL, not production)', () => {
  beforeEach(() => { vi.resetModules(); delete process.env.OPENFISCA_URL; delete process.env.OPENFISCA_API_URL; delete process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE; process.env.NODE_ENV = 'test'; });

  it('the client module really does throw at import in this environment (the premise of the defect)', async () => {
    await expect(import('../../api/lib/openfiscaClient.js')).rejects.toThrow(/OPENFISCA_PROTOTYPE_ENDPOINT_BLOCKED/);
  });
  it('the handler module itself loads (no boot error) and SIMULATION_MODE answers 200 with the assessment contract', async () => {
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'SIMULATION_MODE', answers: ANSWERS } }, r);
    expect(r.statusCode).toBe(200); expect(r.body.assessment.contract).toBe('ADA_ASSESSMENT_CONTRACT_V1'); expect(r.body.rights).toBeUndefined();
  });
  it('AUTHORITATIVE_MODE with an unusable client stays FAIL-CLOSED: 503 OPENFISCA_UNAVAILABLE + ENGINE_UNAVAILABLE assessment, no local fallback, no boot message', async () => {
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { answers: ANSWERS } }, r);
    expect(r.statusCode).toBe(503); expect(r.body.error).toBe('OPENFISCA_UNAVAILABLE');
    expect(r.body.assessment.items.map((i) => i.state)).toEqual(['ENGINE_UNAVAILABLE']);
    expect(JSON.stringify(r.body)).not.toMatch(/PROTOTYPE|BLOCKED|Boot|OPENFISCA_URL|api\.fr\.openfisca/i); expect(r.body.rights).toBeUndefined();
  });
  it('production keeps refusing the public prototype endpoint (the guard itself is unchanged)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(import('../../api/lib/openfiscaClient.js')).rejects.toThrow(/FORBIDDEN_IN_PRODUCTION/);
  });
  it('source guard: no static import of openfiscaClient in the handler', () => {
    expect(readFileSync('api/_handlers/diagnostic.js', 'utf8')).not.toMatch(/^import .* from '\.\.\/lib\/openfiscaClient\.js'/m);
  });
});
