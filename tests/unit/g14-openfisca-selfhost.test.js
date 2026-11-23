/**
 * G14 (owner 23/11/2026) — self-hosted OpenFisca-France on a Scaleway Serverless Container at 0 €:
 * the monthly free-tier guard (api/lib/openfiscaQuota.js), the token sent by the client, the Production preflight check, the free-tier-only deploy script,
 * the version pins kept equal everywhere, and the « simulation unavailable » path of the diagnostic when the guard refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  FREE_TIER, IDLE_MS, LUA_CHARGE, chargeCall, memoryStore, _resetMemoryStore, monthKey, monthlyCapacity, quotaConfig, reserveOpenfiscaCall, usageOf,
} from '../../api/lib/openfiscaQuota.js';
import { OPENFISCA_CORE_PIN, OPENFISCA_FRANCE_PIN, SCALEWAY_TIERS } from '../../api/lib/openfiscaPins.js';
import { openfiscaCheck } from '../../scripts/release-preflight.mjs';
import { TIERS, containerSpec, gzipDeterministic, parseArgs, planText, shapeProblems, specDiff, tarOf } from '../../ops/openfisca/deploy_scaleway.mjs';
import { errorMessageFor } from '../../src/lib/assessmentLabels.js';

const SCW = 'https://adaopenfisca-openfisca-france.functions.fnc.fr-par.scw.cloud';
const cfgOf = (extra = {}) => quotaConfig({ OPENFISCA_URL: SCW, OPENFISCA_TIMEOUT_MS: '30000', OPENFISCA_HEALTH_TIMEOUT_MS: '25000', ...extra });

describe('quota guard — conservative wall-time model of a min-scale 0 / max-scale 1 container', () => {
  it('a call on a stopped instance is charged cold start + call + the 15-minute idle window', () => {
    const cfg = cfgOf();
    const r = chargeCall({ aliveUntil: 0, billedMs: 0 }, 1_000_000, cfg);
    expect(r.allowed).toBe(true);
    expect(r.addedMs).toBe(cfg.coldMs + cfg.callMs + IDLE_MS);
    expect(r.state.aliveUntil).toBe(1_000_000 + cfg.callMs + IDLE_MS);
    expect(r.usage.gbSeconds).toBeCloseTo((r.addedMs / 1000) * 1.024, 6);
    expect(r.usage.vcpuSeconds).toBeCloseTo((r.addedMs / 1000) * 0.56, 6);
  });
  it('a call while the instance is alive only extends the window (no second cold start)', () => {
    const cfg = cfgOf();
    const first = chargeCall({ aliveUntil: 0, billedMs: 0 }, 0, cfg);
    const second = chargeCall(first.state, 60_000, cfg);
    expect(second.addedMs).toBe(60_000);
    expect(second.state.aliveUntil).toBe(60_000 + cfg.callMs + IDLE_MS);
    const late = chargeCall(second.state, second.state.aliveUntil + 1, cfg);   // after scale-to-zero: a new burst
    expect(late.addedMs).toBe(cfg.coldMs + cfg.callMs + IDLE_MS);
  });
  it('refuses at 80 % of the free tier (the binding allowance) and records nothing when refusing', () => {
    const cfg = cfgOf();
    expect(cfg.limits).toEqual({ gbSeconds: FREE_TIER.gbSeconds * 0.8, vcpuSeconds: FREE_TIER.vcpuSeconds * 0.8 });
    let state = { aliveUntil: 0, billedMs: 0 }; let t = 0; let allowed = 0;
    for (;;) { const r = chargeCall(state, t, cfg); if (!r.allowed) { expect(r.state).toEqual(state); break; } state = r.state; allowed++; t = state.aliveUntil + 1; }
    expect(allowed).toBe(monthlyCapacity(cfg).isolatedBursts);
    const u = usageOf(state.billedMs, cfg);
    expect(u.vcpuSeconds).toBeLessThanOrEqual(160_000); expect(u.gbSeconds).toBeLessThanOrEqual(320_000);
    expect(u.vcpuSeconds).toBeGreaterThan(160_000 - (cfg.coldMs + cfg.callMs + IDLE_MS) / 1000);   // stops at the last whole burst under 80 %
  });
  it('the ratio can be lowered, never raised above 0.8; the container shape follows the env', () => {
    expect(cfgOf({ OPENFISCA_QUOTA_RATIO: '0.95' }).ratio).toBe(0.8);
    expect(cfgOf({ OPENFISCA_QUOTA_RATIO: '0.5' }).ratio).toBe(0.5);
    const half = cfgOf({ OPENFISCA_CONTAINER_MEMORY_MB: '512', OPENFISCA_CONTAINER_MVCPU: '280' });
    expect(monthlyCapacity(half).isolatedBursts).toBeGreaterThan(monthlyCapacity(cfgOf()).isolatedBursts * 1.9);
    expect(monthlyCapacity(cfgOf())).toEqual({ isolatedBursts: 281, aliveHours: 79.4, burstSeconds: 1015 });
  });
  it('is off for a loopback LAB engine or without an engine; always on in Production (OPENFISCA_QUOTA_GUARD=off ignored)', () => {
    expect(quotaConfig({ OPENFISCA_URL: 'http://127.0.0.1:5011' }).enabled).toBe(false);
    expect(quotaConfig({}).enabled).toBe(false);
    expect(quotaConfig({ OPENFISCA_URL: SCW, OPENFISCA_QUOTA_GUARD: 'off' }).enabled).toBe(false);
    expect(quotaConfig({ OPENFISCA_URL: SCW, OPENFISCA_QUOTA_GUARD: 'off', NODE_ENV: 'production' }).enabled).toBe(true);
    expect(quotaConfig({ OPENFISCA_URL: 'http://127.0.0.1:5011', VERCEL_ENV: 'production' }).enabled).toBe(true);
  });
  it('one key per UTC month', () => {
    expect(monthKey(Date.parse('2026-11-30T23:59:59Z'))).toBe('openfisca:quota:2026-11');
    expect(monthKey(Date.parse('2026-12-01T00:00:00Z'))).toBe('openfisca:quota:2026-12');
  });
  it('the Lua script of the KV store has the same arithmetic (burst, extension, refusal without write, month expiry)', () => {
    expect(LUA_CHARGE).toMatch(/if now >= au then add = coldMs \+ callMs \+ idleMs else add = math\.max\(0, finish - au\) end/);
    expect(LUA_CHARGE).toMatch(/> limGb or .* > limVcpu then return \{0/);
    expect(LUA_CHARGE.indexOf('return {0')).toBeLessThan(LUA_CHARGE.indexOf("redis.call('HSET'"));
    expect(LUA_CHARGE).toMatch(/EXPIRE/);
  });
});

describe('reserveOpenfiscaCall — never throws, fails closed', () => {
  beforeEach(() => _resetMemoryStore());
  const env = { OPENFISCA_URL: SCW };
  it('LAB without KV: in-memory counter, refuses once the month is spent', async () => {
    const now = Date.parse('2026-11-23T10:00:00Z');
    expect((await reserveOpenfiscaCall({ env, now })).code).toBe('OPENFISCA_QUOTA_OK');
    const cfg = quotaConfig(env);
    const key = monthKey(now);
    const spent = { aliveUntil: 0, billedMs: Math.floor((cfg.limits.vcpuSeconds / cfg.vcpu) * 1000) - 1000 };
    await memoryStore.charge(key, 0, cfg);   // keep the key
    const store = { charge: async (k, n, c) => { const r = chargeCall(spent, n, c); return { allowed: r.allowed, billedMs: r.state.billedMs }; } };
    const refused = await reserveOpenfiscaCall({ env, now: now + 3_600_000, store });
    expect(refused).toMatchObject({ allowed: false, code: 'OPENFISCA_QUOTA_REACHED' });
  });
  it('Production without KV refuses (no counter = no 0 € proof); a KV error or timeout refuses', async () => {
    expect(await reserveOpenfiscaCall({ env: { ...env, NODE_ENV: 'production' } })).toEqual({ allowed: false, code: 'OPENFISCA_QUOTA_STORE_UNAVAILABLE' });
    const broken = { charge: async () => { throw new Error('kv down'); } };
    expect((await reserveOpenfiscaCall({ env, store: broken })).code).toBe('OPENFISCA_QUOTA_STORE_UNAVAILABLE');
  });
  it('a loopback engine is not counted', async () => {
    expect(await reserveOpenfiscaCall({ env: { OPENFISCA_URL: 'http://127.0.0.1:5011' } })).toEqual({ allowed: true, code: 'OPENFISCA_QUOTA_OFF' });
  });
});

describe('client: token headers and cold-start timeouts', () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv('OPENFISCA_URL', 'http://127.0.0.1:5019'); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('sends the token as X-Auth-Token (Scaleway gateway) and X-ADA-OpenFisca-Token (container gate) on /calculate and /spec', async () => {
    vi.stubEnv('OPENFISCA_AUTH_TOKEN', 'synthetic-token-not-a-secret-0123');
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }));
    vi.stubGlobal('fetch', fetch);
    const c = await import('../../api/lib/openfiscaClient.js');
    await c.calculate({ individus: {} });
    await c.isAvailable();
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers['X-Auth-Token']).toBe('synthetic-token-not-a-secret-0123');
      expect(init.headers['X-ADA-OpenFisca-Token']).toBe('synthetic-token-not-a-secret-0123');
    }
    const { engineHealth } = await import('../../api/lib/openfiscaEngine.js');
    await engineHealth();
    expect(fetch.mock.calls.at(-1)[1].headers['X-Auth-Token']).toBe('synthetic-token-not-a-secret-0123');
  });
  it('without a token (LAB loopback): no auth header, as before', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetch);
    const c = await import('../../api/lib/openfiscaClient.js');
    await c.calculate({ individus: {} });
    expect(Object.keys(fetch.mock.calls[0][1].headers)).toEqual(['Content-Type']);
    expect(c.authHeaders()).toEqual({});
  });
  it('OPENFISCA_TIMEOUT_MS is read and bounded (default 5000 ms, max 60 s)', () => {
    const src = readFileSync('api/lib/openfiscaClient.js', 'utf8');
    expect(src).toMatch(/boundedMs\(process\.env\.OPENFISCA_TIMEOUT_MS, 5000\)/);
    expect(src).toMatch(/boundedMs\(process\.env\.OPENFISCA_HEALTH_TIMEOUT_MS, 2000\)/);
    expect(src).toMatch(/Math\.min\(Math\.max\(n, 1000\), 60_000\)/);
  });
});

describe('diagnostic: a refused call takes the « simulation unavailable » path (no engine contact, no fallback result)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.doUnmock('../../api/lib/openfiscaQuota.js'); vi.unstubAllEnvs(); });
  it('503 OPENFISCA_QUOTA_REACHED with the French message and a non-retryable ENGINE_UNAVAILABLE assessment', async () => {
    vi.doMock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 'run-1' }] }) }), update: () => ({ set: () => ({ where: async () => [] }) }) } }));
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
    vi.doMock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));
    vi.doMock('../../api/lib/openfiscaQuota.js', async (orig) => ({ ...(await orig()), reserveOpenfiscaCall: async () => ({ allowed: false, code: 'OPENFISCA_QUOTA_REACHED' }) }));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubEnv('OPENFISCA_URL', SCW);
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { answers: { birthDate: '1990-01-01', householdSize: 1, income: { salary: 0 }, housing: { status: 'tenant', rent: 400 } } } }, r);
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBe('OPENFISCA_QUOTA_REACHED');
    expect(r.body.message).toMatch(/mois prochain/);
    expect(r.body.assessment.retryable).toBe(false);
    expect(r.body.assessment.items.map((i) => i.state)).toEqual(['ENGINE_UNAVAILABLE']);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('the interface message is keyed on the code (namespace diagnostic, 6 languages)', () => {
    expect(errorMessageFor(503, 'OPENFISCA_QUOTA_REACHED')).toMatch(/mois prochain/);
    expect(errorMessageFor(503, 'OPENFISCA_UNAVAILABLE')).not.toMatch(/mois prochain/);
    for (const l of ['en', 'tr', 'ar', 'de', 'uk']) {
      const d = JSON.parse(readFileSync(`src/i18n/locales/${l}/diagnostic.json`, 'utf8'));
      expect(d['error.quota_reached'], l).toBeTruthy();
    }
    expect(readFileSync('src/lib/assessmentLabelsI18n.js', 'utf8')).toContain("t('diagnostic:error.quota_reached'");
  });
});

describe('release preflight — openfisca.self_hosted', () => {
  const ok = { OPENFISCA_URL: SCW, OPENFISCA_AUTH_TOKEN: 'x'.repeat(40), OPENFISCA_FRANCE_VERSION: '176.1.6', OPENFISCA_TIMEOUT_MS: '30000', OPENFISCA_HEALTH_TIMEOUT_MS: '25000' };
  const check = (env) => openfiscaCheck((k) => String(env[k] ?? '').trim());
  it('PASS when not configured (simulation mode only) and for the self-hosted private engine', () => {
    expect(check({})[0]).toBe('PASS');
    expect(check(ok)[0]).toBe('PASS');
  });
  it('FAIL: public prototype, no token, http, loopback, wrong version, prototype opt-in, inconsistent tier', () => {
    expect(check({ ...ok, OPENFISCA_URL: 'https://api.fr.openfisca.org/latest' })[0]).toBe('FAIL');
    expect(check({ ...ok, OPENFISCA_AUTH_TOKEN: '' })[0]).toBe('FAIL');
    expect(check({ ...ok, OPENFISCA_URL: 'http://openfisca.example.test' })[0]).toBe('FAIL');
    expect(check({ ...ok, OPENFISCA_URL: 'https://127.0.0.1:5011' })[0]).toBe('FAIL');
    expect(check({ ...ok, OPENFISCA_FRANCE_VERSION: '' })[0]).toBe('FAIL');
    expect(check({ ...ok, ALLOW_OPENFISCA_PUBLIC_PROTOTYPE: 'true' })[0]).toBe('FAIL');
    expect(check({ ...ok, OPENFISCA_CONTAINER_MEMORY_MB: '1024', OPENFISCA_CONTAINER_MVCPU: '1000' })[0]).toBe('FAIL');
    expect(check({ ...ok, OPENFISCA_API_URL: 'https://api.fr.openfisca.org/latest', OPENFISCA_URL: '' })[0]).toBe('FAIL');
  });
  it('WARN: short timeouts (cold start), non-Scaleway host, guard switch in Production; the detail never carries a value', () => {
    const w = check({ ...ok, OPENFISCA_TIMEOUT_MS: '' });
    expect(w[0]).toBe('WARN');
    expect(check({ ...ok, OPENFISCA_URL: 'https://openfisca.example.test' })[0]).toBe('WARN');
    expect(check({ ...ok, OPENFISCA_QUOTA_GUARD: 'off' })[0]).toBe('WARN');
    expect(JSON.stringify(check(ok))).not.toContain('x'.repeat(40));
  });
});

describe('deploy script — free-tier shape only, dry run by default', () => {
  it('defaults are free-tier-shaped and a dry run needs nothing', () => {
    const o = parseArgs([]);
    expect(o.apply).toBe(false);
    expect(shapeProblems(o)).toEqual([]);
    expect(planText(o)).toMatch(/^DRY RUN/);
  });
  it('refuses max-scale > 1, min-scale > 0, unknown tier, public privacy, another region, --apply without a project', () => {
    expect(shapeProblems(parseArgs(['--max-scale', '2'])).join()).toMatch(/max-scale/);
    expect(shapeProblems(parseArgs(['--min-scale', '1'])).join()).toMatch(/min-scale/);
    expect(shapeProblems(parseArgs(['--memory', '768'])).join()).toMatch(/memory/);
    expect(shapeProblems(parseArgs(['--privacy', 'public'])).join()).toMatch(/private/);
    expect(shapeProblems(parseArgs(['--region', 'nl-ams'])).join()).toMatch(/fr-par/);
    expect(shapeProblems(parseArgs(['--apply'])).join()).toMatch(/project-id/);
    expect(shapeProblems(parseArgs(['--apply', '--project-id', '11111111-2222-3333-4444-555555555555']))).toEqual([]);
    expect(() => parseArgs(['--yolo'])).toThrow(/unknown argument/);
  });
  it('the container spec is min 0 / max 1 / private / tier-consistent; a drift is patched back', () => {
    const want = containerSpec(parseArgs([]), 'rg.fr-par.scw.cloud/ada-c7-base/openfisca-france@sha256:00');
    expect(want).toMatchObject({ min_scale: 0, max_scale: 1, privacy: 'private', memory_limit: 1024, cpu_limit: 560, port: 8080 });
    expect(JSON.stringify(want)).not.toMatch(/secret|token_sha|TOKEN_SHA256/i);
    expect(specDiff(want, want)).toEqual({});
    expect(specDiff({ ...want, max_scale: 5, privacy: 'public' }, want)).toEqual({ max_scale: 1, privacy: 'private' });
  });
  it('tiers agree with the guard and the preflight', () => {
    expect(TIERS).toEqual(SCALEWAY_TIERS);
  });
  it('the reproducible layer tar: ustar entries, pax for a long path, root-owned, fixed mtime, deterministic gzip', () => {
    const long = `opt/${'a'.repeat(120)}/${'b'.repeat(120)}.py`;
    const tar = tarOf([{ name: 'opt', dir: true }, { name: 'opt/x.py', data: Buffer.from('print(1)\n') }, { name: long, data: Buffer.from('#\n') }]);
    expect(tar.length % 512).toBe(0);
    const hdr = (off) => ({ name: tar.subarray(off, off + 100).toString().replace(/\0.*$/s, ''), type: String.fromCharCode(tar[off + 156]), uid: tar.subarray(off + 108, off + 115).toString(), magic: tar.subarray(off + 257, off + 262).toString(),
      sumOk: (() => { const h = Buffer.from(tar.subarray(off, off + 512)); const want = parseInt(h.subarray(148, 154).toString(), 8); h.fill(' ', 148, 156); let s = 0; for (const b of h) s += b; return s === want; })() });
    expect(hdr(0)).toMatchObject({ name: 'opt/', type: '5', uid: '0000000', magic: 'ustar', sumOk: true });
    expect(hdr(512)).toMatchObject({ name: 'opt/x.py', type: '0', sumOk: true });
    expect(hdr(1536)).toMatchObject({ type: 'x', sumOk: true });
    expect(tar.subarray(2048, 2560).toString()).toContain(`path=${long}`);
    const gz = gzipDeterministic(tar);
    expect(gzipDeterministic(tar).equals(gz)).toBe(true);
    expect(gunzipSync(gz).equals(tar)).toBe(true);
  });
});

describe('version pins are equal everywhere (change all together)', () => {
  it('openfiscaPins.js = openfisca-local.sh = requirements.txt/.lock = both Dockerfiles = the 176 fixture = deploy script', () => {
    const local = readFileSync('scripts/openfisca-local.sh', 'utf8');
    expect(local).toContain(`OPENFISCA_FRANCE_PIN="${OPENFISCA_FRANCE_PIN}"`);
    expect(local).toContain(`OPENFISCA_CORE_PIN="${OPENFISCA_CORE_PIN}"`);
    const req = readFileSync('ops/openfisca/requirements.txt', 'utf8');
    expect(req).toContain(`openfisca-core[web-api]==${OPENFISCA_CORE_PIN}`); expect(req).toContain(`openfisca-france==${OPENFISCA_FRANCE_PIN}`);
    const lock = readFileSync('ops/openfisca/requirements.lock', 'utf8');
    expect(lock).toContain(`openfisca-core==${OPENFISCA_CORE_PIN}`); expect(lock).toContain(`openfisca-france==${OPENFISCA_FRANCE_PIN}`);
    expect(lock.match(/--hash=sha256:/g).length).toBeGreaterThanOrEqual(28);
    expect(readFileSync('infrastructure/openfisca/Dockerfile', 'utf8')).toContain(`"openfisca-france==${OPENFISCA_FRANCE_PIN}"`);
    expect(readFileSync('ops/openfisca/Dockerfile', 'utf8')).toMatch(/--require-hashes/);
    expect(readFileSync('tests/fixtures/openfisca-france-176-variables.json', 'utf8')).toContain(`OpenFisca-France ${OPENFISCA_FRANCE_PIN} / OpenFisca-Core ${OPENFISCA_CORE_PIN}`);
    expect(readFileSync('ops/openfisca/deploy_scaleway.mjs', 'utf8')).toContain(`FRANCE_PIN = '${OPENFISCA_FRANCE_PIN}'`);
  });
  it('the container app is non-root, token-gated, no tracker, unmodified engine', () => {
    const app = readFileSync('ops/openfisca/ada_openfisca_app.py', 'utf8');
    expect(app).toMatch(/create_app\(_tbs, welcome_message=/);   // no tracker_url => no outbound call
    expect(app).toMatch(/hmac\.compare_digest/);
    expect(app).toMatch(/"ADA_OPENFISCA_REQUIRE_TOKEN", "1"/);
    expect(readFileSync('ops/openfisca/Dockerfile', 'utf8')).toMatch(/^USER 65534:65534$/m);
    expect(readFileSync('ops/openfisca/gunicorn.conf.py', 'utf8')).toMatch(/^workers = int\(os\.environ\.get\("ADA_OPENFISCA_WORKERS", "1"\)\)$/m);
  });
});
