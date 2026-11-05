/**
 * R46 (D10) — the local-engine adapter end to end against a loopback STUB of the OpenFisca Web API (tests/helpers/openfisca-stub-engine.mjs): the health
 * check reads the version the engine states and fails closed on another one; the verification script (scripts/openfisca-verify.mjs) runs the same chain as
 * POST /api/diagnostic and checks the qualified-output contract; the handler's AUTHORITATIVE_MODE answers with the engine's own version and, per right, whether
 * its rule passed the D11 expert gate (none does). The stub computes nothing: it proves our side only (real-engine protocol evidence: R14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { startStubEngine } from '../helpers/openfisca-stub-engine.mjs';
import { contractViolations, REPORT_MARK } from '../../scripts/openfisca-verify.mjs';
import { qualifyEstimates } from '../../api/lib/openfiscaEstimate.js';

vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 'run-1' }] }) }), update: () => ({ set: () => ({ where: async () => [] }) }) } }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const FULL = { birthDate: '1990-04-12', statut: 'salarié', householdSize: 1, income: { salary: 1100 }, housing: { status: 'tenant', rent: 520, charges: 40 }, depcom: '67482' };
const VALUES = { aide_logement: 231.4, apl: 231.4, ppa: 154.2, rsa: 0 };
let engine;
const env = (url, version) => { process.env.OPENFISCA_URL = url; if (version === undefined) delete process.env.OPENFISCA_FRANCE_VERSION; else process.env.OPENFISCA_FRANCE_VERSION = version; };
/** asynchronous on purpose: the stub engine runs in THIS process and must keep answering while the script runs */
const runVerify = (url, version) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['scripts/openfisca-verify.mjs'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', TZ: 'UTC', OPENFISCA_URL: url, ...(version ? { OPENFISCA_FRANCE_VERSION: version } : {}) } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

describe('D10 engine identity check (api/lib/openfiscaEngine.js, loopback stub engine; the client module stays byte-identical)', () => {
  beforeEach(() => { vi.resetModules(); process.env.NODE_ENV = 'test'; });
  afterEach(async () => { await engine?.close(); engine = null; delete process.env.OPENFISCA_URL; delete process.env.OPENFISCA_FRANCE_VERSION; });

  it('reads the country package and version the engine states; the pinned version passes', async () => {
    engine = await startStubEngine({ version: '176.1.6' }); env(engine.url, '176.1.6');
    const { engineHealth } = await import('../../api/lib/openfiscaEngine.js');
    expect(await engineHealth()).toEqual({ ok: true, code: 'OPENFISCA_OK', configured: true, reachable: true, countryPackage: 'openfisca-france', version: '176.1.6', expectedVersion: '176.1.6' });
  });
  it('another version, an engine that does not state its version, another country package or no engine: unavailable (fail closed)', async () => {
    engine = await startStubEngine({ version: '163.0.0' }); env(engine.url, '176.1.6');
    let c = await import('../../api/lib/openfiscaEngine.js');
    expect(await c.engineHealth()).toMatchObject({ ok: false, code: 'OPENFISCA_VERSION_MISMATCH', version: '163.0.0' });
        await engine.close(); vi.resetModules();
    engine = await startStubEngine({ version: null }); env(engine.url, '176.1.6');
    c = await import('../../api/lib/openfiscaEngine.js');
    expect(await c.engineHealth()).toMatchObject({ ok: false, code: 'OPENFISCA_VERSION_UNKNOWN' });
    await engine.close(); vi.resetModules();
    engine = await startStubEngine({ countryPackage: 'openfisca-tunisia' }); env(engine.url, undefined);
    c = await import('../../api/lib/openfiscaEngine.js');
    expect(await c.engineHealth()).toMatchObject({ ok: false, code: 'OPENFISCA_WRONG_COUNTRY_PACKAGE' });
    await engine.close(); engine = null; vi.resetModules(); env('http://127.0.0.1:9', undefined);
    c = await import('../../api/lib/openfiscaEngine.js');
    expect(await c.engineHealth()).toMatchObject({ ok: false, code: 'OPENFISCA_HEALTH_UNREACHABLE', reachable: false });
    delete process.env.OPENFISCA_URL;
    expect(await c.engineHealth()).toMatchObject({ ok: false, code: 'OPENFISCA_NOT_CONFIGURED', configured: false });
    process.env.OPENFISCA_URL = 'https://api.fr.openfisca.org/latest';
    expect(await c.engineHealth()).toMatchObject({ ok: false, code: 'OPENFISCA_PUBLIC_PROTOTYPE_NOT_CHECKED' });
  });
  it('without a pin, a reachable engine is usable and its stated version is reported', async () => {
    engine = await startStubEngine({ version: '176.1.6' }); env(engine.url, undefined);
    const { engineHealth } = await import('../../api/lib/openfiscaEngine.js');
    expect(await engineHealth()).toMatchObject({ ok: true, version: '176.1.6', expectedVersion: null });
  });
});

describe('D10 AUTHORITATIVE_MODE through the handler (stub engine): qualified, versioned, gated by D11', () => {
  beforeEach(() => { vi.resetModules(); process.env.NODE_ENV = 'test'; });
  afterEach(async () => { await engine?.close(); engine = null; delete process.env.OPENFISCA_URL; delete process.env.OPENFISCA_FRANCE_VERSION; });

  it('200 with the engine-stated version; no raw value; every right NOT_EXPERT_VALIDATED or NOT_IN_REGISTER; never authoritative', async () => {
    engine = await startStubEngine({ version: '176.1.6', values: VALUES }); env(engine.url, '176.1.6');
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { answers: FULL } }, r);
    expect(r.statusCode).toBe(200);
    expect(engine.calls).toHaveLength(1);
    expect(r.body.authoritative).toBe(false);
    expect(r.body.meta.engineVersion).toBe('176.1.6');
    const est = r.body.estimates;
    expect(est.engine).toEqual({ name: 'openfisca-france', version: '176.1.6' });
    expect(contractViolations(est)).toEqual([]);
    expect(est.d11Gate.validatedRules).toEqual([]);
    expect(new Set(est.items.map((i) => i.ruleValidation))).toEqual(new Set(['NOT_EXPERT_VALIDATED', 'NOT_IN_REGISTER']));
    expect(est.items.find((i) => i.code === 'rsa').ruleValidation).toBe('NOT_EXPERT_VALIDATED');
    expect(JSON.stringify(r.body)).not.toMatch(/"eligible"|231\.4|154\.2/);
  });
  it('a version mismatch answers the existing fail-closed 503 (no estimate, no local fallback)', async () => {
    engine = await startStubEngine({ version: '163.0.0', values: VALUES }); env(engine.url, '176.1.6');
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { answers: FULL } }, r);
    expect(r.statusCode).toBe(503); expect(r.body.error).toBe('OPENFISCA_UNAVAILABLE'); expect(engine.calls).toHaveLength(0); expect(r.body.estimates).toBeUndefined();
  });
  it('only a rule that passed the gate is marked EXPERT_VALIDATED, and the estimate is still not authoritative', () => {
    const est = qualifyEstimates([{ code: 'apl', label: 'APL', category: 'logement', amount: 231.4 }, { code: 'rsa', label: 'RSA', category: 'x', amount: 0 }], FULL, { period: '2026-11', validatedRules: ['apl'] });
    expect(est.items.map((i) => [i.code, i.ruleValidation])).toEqual([['apl', 'EXPERT_VALIDATED'], ['rsa', 'NOT_EXPERT_VALIDATED']]);
    expect(est.authoritative).toBe(false); expect(est.d11Gate.validatedRules).toEqual(['apl']);
  });
});

describe('D10 verification script and reproducible local run', () => {
  afterEach(async () => { await engine?.close(); engine = null; });
  it('scripts/openfisca-verify.mjs passes against a conforming engine and every synthetic situation conforms', async () => {
    engine = await startStubEngine({ version: '176.1.6', values: VALUES });
    const out = await runVerify(engine.url, '176.1.6');
    expect(out.status, out.stderr).toBe(0);
    const rep = JSON.parse(out.stdout.split(REPORT_MARK)[1]);
    expect(rep.pass).toBe(true); expect(rep.health.version).toBe('176.1.6');
    expect(rep.situations.map((s) => s.ok)).toEqual([true, true, true, true]);
    expect(engine.calls).toHaveLength(4);
  });
  it('fails (exit 1, no calculation sent) when the engine is not the pinned version', async () => {
    engine = await startStubEngine({ version: '163.0.0' });
    const out = await runVerify(engine.url, '176.1.6');
    expect(out.status).toBe(1); expect(JSON.parse(out.stdout.split(REPORT_MARK)[1]).health.code).toBe('OPENFISCA_VERSION_MISMATCH'); expect(engine.calls).toHaveLength(0);
  });
  it('the contract checker catches a raw value, an amount without inputs and a missing D11 marker', () => {
    const bad = { contract: 'ADA_OPENFISCA_ESTIMATE_V1', authoritative: false, assumptions: ['x'], d11Gate: { validatedRules: [] },
      items: [{ code: 'rsa', status: 'INSUFFICIENT_INFORMATION', monthlyOrderOfMagnitude: 420, missing: [], ruleValidation: 'NOT_EXPERT_VALIDATED', eligible: true }, { code: 'apl', status: 'INDICATIVE_ESTIMATE', monthlyOrderOfMagnitude: 233 }] };
    expect(contractViolations(bad)).toEqual(['item rsa: raw engine value', 'item rsa: amount without inputs', 'item rsa: missing inputs not named', 'item apl: ruleValidation', 'item apl: order of magnitude']);
  });
  it('the local run script, the Dockerfile and the R14 fixture pin the same engine; the script binds loopback and refuses port 3000', () => {
    const sh = fs.readFileSync('scripts/openfisca-local.sh', 'utf8');
    const docker = fs.readFileSync('infrastructure/openfisca/Dockerfile', 'utf8');
    const fixture = JSON.parse(fs.readFileSync('tests/fixtures/openfisca-france-176-variables.json', 'utf8')).engine;
    const france = sh.match(/OPENFISCA_FRANCE_PIN="([\d.]+)"/)[1]; const core = sh.match(/OPENFISCA_CORE_PIN="([\d.]+)"/)[1];
    expect(docker).toContain(`openfisca-france==${france}`); expect(docker).toContain(`==${core}`);
    expect(fixture).toContain(`OpenFisca-France ${france}`); expect(fixture).toContain(`OpenFisca-Core ${core}`);
    expect(sh).toMatch(/--bind 127\.0\.0\.1/);
    const r = spawnSync('bash', ['scripts/openfisca-local.sh', 'env'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, OPENFISCA_PORT: '3000' } });
    expect(r.status).toBe(2);
    const ok = spawnSync('bash', ['scripts/openfisca-local.sh', 'env'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    expect(ok.stdout).toBe(`OPENFISCA_URL=http://127.0.0.1:5011\nOPENFISCA_FRANCE_VERSION=${france}\n`);
  });
});
