/**
 * G14 (23/11/2026) — the citizen « estimation indicative » of the self-hosted OpenFisca engine (server side).
 *  - an amount only for a right whose inputs were all given, from the PINNED engine, under legislation in force for the period (api/lib/openfiscaLegislation.js);
 *  - « Seul l'organisme (CAF, CPAM, Département…) décide de vos droits », the legislation date, official links, « À vérifier auprès de l'organisme
 *    compétent » for every rule not EXPERT_VALIDATED (D11, owner decision « option A »; OWNER_VALIDATED never applied on the server); never an entitlement claim;
 *  - GET /api/diagnostic/estimate-availability: configuration + quota, read only (the engine is not contacted, nothing is charged);
 *  - POST /api/diagnostic (AUTHORITATIVE_MODE) with a mocked engine carries the citizen block; NOTHING of the answers is logged, stored or sent to Sentry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CITIZEN_ESTIMATE_CONTRACT, DECIDES_NOTICE, LEGISLATION, VERIFY_NOTICE, citizenEstimate, estimateConfigProblem, frenchDate, legislationFor } from '../../api/lib/openfiscaLegislation.js';
import { OPENFISCA_FRANCE_PIN } from '../../api/lib/openfiscaPins.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { chargeCall, memoryStore, monthKey, peekOpenfiscaQuota, quotaConfig, _resetMemoryStore } from '../../api/lib/openfiscaQuota.js';

const item = (code, status, amount = null, ruleValidation = 'NOT_EXPERT_VALIDATED', missing = []) => ({ code, label: code.toUpperCase(), category: 'x', status, ruleValidation,
  monthlyOrderOfMagnitude: amount, missing: missing.map((key) => ({ key, label: key })) });
const est = (items) => ({ contract: 'ADA_OPENFISCA_ESTIMATE_V1', authoritative: false, assumptions: ['Hypothèse A.'], items });

describe('legislation of the pinned engine', () => {
  it('records the pinned version only, with the start date of the engine’s latest values (read from openfisca-france 176.1.6)', () => {
    expect(Object.keys(LEGISLATION)).toEqual([OPENFISCA_FRANCE_PIN]);
    expect(LEGISLATION[OPENFISCA_FRANCE_PIN].rsa.inForceFrom).toBe('2026-04-01');
    expect(LEGISLATION[OPENFISCA_FRANCE_PIN].prime_activite.inForceFrom).toBe('2026-04-01');
    expect(LEGISLATION[OPENFISCA_FRANCE_PIN].apl.inForceFrom).toBe('2026-10-01');
    for (const r of Object.values(LEGISLATION[OPENFISCA_FRANCE_PIN])) {
      expect(r.fiche).toMatch(/^https:\/\/www\.service-public\.gouv\.fr\/particuliers\/vosdroits\/F\d+$/);
      expect(r.simulator).toMatch(/^https:\/\/www\.(caf\.fr|mesdroitssociaux\.gouv\.fr)\//);
    }
    expect(LEGISLATION[OPENFISCA_FRANCE_PIN].css).toBeUndefined();   // a participation is a cost, never shown as an aid amount
  });
  it('is in force from its date until the next annual revaluation; another engine version knows nothing', () => {
    expect(legislationFor('rsa', '2026-11', OPENFISCA_FRANCE_PIN).ok).toBe(true);
    expect(legislationFor('rsa', '2026-03', OPENFISCA_FRANCE_PIN)).toMatchObject({ ok: false, reason: 'LEGISLATION_UNKNOWN_FOR_PERIOD' });
    expect(legislationFor('rsa', '2027-03', OPENFISCA_FRANCE_PIN).ok).toBe(true);
    expect(legislationFor('rsa', '2027-04', OPENFISCA_FRANCE_PIN)).toMatchObject({ ok: false, reason: 'LEGISLATION_UNKNOWN_FOR_PERIOD' });
    expect(legislationFor('apl', '2026-09', OPENFISCA_FRANCE_PIN).ok).toBe(false);
    expect(legislationFor('apl', '2026-10', OPENFISCA_FRANCE_PIN).ok).toBe(true);
    expect(legislationFor('rsa', '2026-11', '176.1.7')).toMatchObject({ ok: false, reason: 'ENGINE_NOT_PINNED' });
    expect(legislationFor('rsa', '2026-11', null)).toMatchObject({ ok: false, reason: 'ENGINE_NOT_PINNED' });
    expect(legislationFor('aah', '2026-11', OPENFISCA_FRANCE_PIN)).toMatchObject({ ok: false, reason: 'NO_LEGISLATION_RECORD' });
    expect(frenchDate('2026-04-01')).toBe('1er avril 2026');
  });
});

describe('citizenEstimate', () => {
  const ctx = { period: '2026-11', engineVersion: OPENFISCA_FRANCE_PIN };
  it('an amount only for a fully-informed right under the pinned legislation in force; every other case says why there is none', () => {
    const c = citizenEstimate(est([
      item('rsa', 'INDICATIVE_ESTIMATE', 650), item('prime_activite', 'NOT_INDICATED_UNDER_ASSUMPTIONS'), item('apl', 'INSUFFICIENT_INFORMATION', null, 'NOT_EXPERT_VALIDATED', ['commune']),
      item('aspa', 'INDICATIVE_ESTIMATE', 900, 'NOT_IN_REGISTER'), item('css', 'INDICATIVE_ESTIMATE', 30),
    ]), ctx);
    expect(c).toMatchObject({ contract: CITIZEN_ESTIMATE_CONTRACT, kind: 'ESTIMATION_INDICATIVE', authoritative: false, period: '2026-11', decidesNotice: DECIDES_NOTICE, verifyNotice: VERIFY_NOTICE });
    expect(DECIDES_NOTICE).toBe('Seul l’organisme (CAF, CPAM, Département…) décide de vos droits.');
    const by = Object.fromEntries(c.items.map((i) => [i.code, i]));
    expect(by.rsa).toMatchObject({ monthlyAmount: 650, amountWithheld: null, legislation: { inForceFrom: '2026-04-01', label: 'Législation en vigueur au 1er avril 2026' }, organisme: 'Caf (ou MSA)' });
    expect(by.rsa.officialLinks.map((l) => l.kind)).toEqual(['fiche', 'simulator']);
    expect(by.prime_activite).toMatchObject({ monthlyAmount: null, amountWithheld: 'NOT_INDICATED' });
    expect(by.apl).toMatchObject({ monthlyAmount: null, amountWithheld: 'MISSING_INPUTS', missing: ['commune'] });
    expect(by.aspa).toMatchObject({ monthlyAmount: null, amountWithheld: 'NO_LEGISLATION_RECORD', legislation: null });
    expect(by.css).toMatchObject({ monthlyAmount: null, amountWithheld: 'NO_LEGISLATION_RECORD' });
    expect(by.aspa.officialLinks).toEqual([{ kind: 'simulator', url: 'https://www.mesdroitssociaux.gouv.fr/' }]);
  });
  it('no amount at all from an engine that did not state the pinned version, or for a period outside the legislation', () => {
    const items = [item('rsa', 'INDICATIVE_ESTIMATE', 650)];
    expect(citizenEstimate(est(items), { period: '2026-11', engineVersion: null }).items[0]).toMatchObject({ monthlyAmount: null, amountWithheld: 'ENGINE_NOT_PINNED' });
    expect(citizenEstimate(est(items), { period: '2027-05', engineVersion: OPENFISCA_FRANCE_PIN }).items[0]).toMatchObject({ monthlyAmount: null, amountWithheld: 'LEGISLATION_UNKNOWN_FOR_PERIOD' });
  });
  it('D11: « À vérifier auprès de l’organisme compétent » for every rule that is not EXPERT_VALIDATED (owner-validated included); never an entitlement claim', () => {
    const c = citizenEstimate(est([item('rsa', 'INDICATIVE_ESTIMATE', 650, 'OWNER_VALIDATED'), item('apl', 'INDICATIVE_ESTIMATE', 200, 'EXPERT_VALIDATED'), item('aah', 'INSUFFICIENT_INFORMATION', null, 'NOT_EXPERT_VALIDATED', ['disabilityRate'])]), ctx);
    expect(c.items.map((i) => i.verifyWithOrganism)).toEqual([true, false, true]);
    expect(claimsEntitlement(c)).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/éligible|eligible/i);
  });
});

describe('estimate availability (configuration + quota, read only)', () => {
  const ok = { OPENFISCA_URL: 'https://ada-openfisca.functions.fnc.fr-par.scw.cloud', OPENFISCA_FRANCE_VERSION: OPENFISCA_FRANCE_PIN, OPENFISCA_AUTH_TOKEN: 'synthetic-token-0123456789' };
  it('offered only for a configured, pinned (and in Production token-protected) engine that is not the public prototype', () => {
    expect(estimateConfigProblem({})).toBe('OPENFISCA_NOT_CONFIGURED');
    expect(estimateConfigProblem({ ...ok, OPENFISCA_FRANCE_VERSION: '' })).toBe('OPENFISCA_VERSION_NOT_PINNED');
    expect(estimateConfigProblem({ ...ok, OPENFISCA_URL: 'https://api.fr.openfisca.org/latest' })).toBe('OPENFISCA_PUBLIC_PROTOTYPE');
    expect(estimateConfigProblem({ ...ok, OPENFISCA_AUTH_TOKEN: '', VERCEL_ENV: 'production' })).toBe('OPENFISCA_TOKEN_MISSING');
    expect(estimateConfigProblem(ok)).toBeNull();
    expect(estimateConfigProblem({ ...ok, OPENFISCA_AUTH_TOKEN: '', OPENFISCA_URL: 'http://127.0.0.1:5011' })).toBeNull();   // LAB loopback engine
  });
  it('the quota peek charges nothing', async () => {
    _resetMemoryStore();
    const env = { OPENFISCA_URL: ok.OPENFISCA_URL };
    const now = Date.parse('2026-11-23T10:00:00Z');
    expect(await peekOpenfiscaQuota({ env, now })).toEqual({ allowed: true, code: 'OPENFISCA_QUOTA_OK' });
    expect(await memoryStore.read(monthKey(now))).toEqual({ aliveUntil: 0, billedMs: 0 });
    const cfg = quotaConfig(env);
    const spent = { read: async () => ({ aliveUntil: 0, billedMs: Math.ceil((cfg.limits.vcpuSeconds / cfg.vcpu) * 1000) }), charge: async () => { throw new Error('must not charge'); } };
    expect(await peekOpenfiscaQuota({ env, now, store: spent })).toEqual({ allowed: false, code: 'OPENFISCA_QUOTA_REACHED' });
    expect(chargeCall).toBeTypeOf('function');
  });
});

/* ── the handler, with a mocked engine ─────────────────────────────────── */
const R = vi.hoisted(() => ({ logs: [], sentry: [], db: [] }));
vi.mock('../../src/db/index.js', () => ({ db: {
  insert: () => ({ values: (v) => { R.db.push(v); return { returning: async () => [{ id: 'run-1' }] }; } }),
  update: () => ({ set: (v) => { R.db.push(v); return { where: async () => [] }; } }),
} }));
vi.mock('../../api/_utils/logger.js', () => { const m = (l) => (...a) => R.logs.push({ l, a }); return { default: { info: m('info'), warn: m('warn'), error: m('error'), debug: m('debug') } }; });
vi.mock('../../api/lib/logger.js', () => { const m = (l) => (...a) => R.logs.push({ l, a }); return { logger: { info: m('info'), warn: m('warn'), error: m('error'), debug: m('debug') } }; });
vi.mock('@sentry/node', () => ({ captureException: (...a) => R.sentry.push(a), captureMessage: (...a) => R.sentry.push(a), addBreadcrumb: (...a) => R.sentry.push(a), withScope: (f) => f({ setExtra() {}, setTag() {} }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));

const URL_ = 'https://ada-openfisca.functions.fnc.fr-par.scw.cloud';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
// sentinel answers: none of these strings may reach a log, Sentry, the database or the quota store
const SENT = { birthDate: '1987-06-05', salary: 1234.56, rent: 543.21, territory: '67123', depcom: '67218' };
const ANSWERS = { birthDate: SENT.birthDate, householdSize: 1, territory: SENT.territory, statut: 'salarié', income: { salary: SENT.salary }, housing: { status: 'tenant', rent: SENT.rent, charges: 0 } };
const WITH_COMMUNE = { ...ANSWERS, depcom: SENT.depcom };
function engine(posts) {
  return vi.fn(async (url, init = {}) => {
    const headers = { get: (n) => ({ 'country-package': 'openfisca-france', 'country-package-version': OPENFISCA_FRANCE_PIN })[String(n).toLowerCase()] ?? null };
    if (String(url).endsWith('/spec')) return { ok: true, status: 200, headers, json: async () => ({}) };
    const body = JSON.parse(init.body); posts.push(body);
    const p = Object.values(body.familles.fam_1.rsa || {}).length ? Object.keys(body.familles.fam_1.rsa)[0] : '2026-11';
    const housing = body.menages?.men_1?.depcom ? 231.6 : 0;   // the engine needs the commune for the housing aid
    const fam = { ...body.familles.fam_1, rsa: { [p]: 0 }, ppa: { [p]: 187.4 }, apl: { [p]: housing }, aide_logement: { [p]: housing } };
    return { ok: true, status: 200, headers, json: async () => ({ ...body, familles: { fam_1: fam } }) };
  });
}

describe('POST /api/diagnostic (AUTHORITATIVE_MODE) and GET estimate-availability, mocked engine', () => {
  beforeEach(() => {
    vi.resetModules(); R.logs.length = 0; R.sentry.length = 0; R.db.length = 0; _resetMemoryStore();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    vi.stubEnv('OPENFISCA_URL', URL_); vi.stubEnv('OPENFISCA_FRANCE_VERSION', OPENFISCA_FRANCE_PIN); vi.stubEnv('OPENFISCA_AUTH_TOKEN', 'synthetic-token-0123456789');
    vi.stubEnv('KV_REST_API_URL', ''); vi.stubEnv('KV_REST_API_TOKEN', '');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('availability: available, read only — the engine is not contacted', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'GET', url: '/api/diagnostic/estimate-availability', headers: { host: 'x' }, socket: {} }, r);
    expect(r.statusCode).toBe(200); expect(r.body).toMatchObject({ available: true, reason: null }); expect(r.headers['Cache-Control']).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('OPENFISCA_FRANCE_VERSION', '');
    const r2 = mk(); await handler({ method: 'GET', url: '/api/diagnostic/estimate-availability', headers: { host: 'x' }, socket: {} }, r2);
    expect(r2.body).toEqual({ available: false, reason: 'OPENFISCA_VERSION_NOT_PINNED' });
  });

  it('the answer carries the citizen estimate: amounts only under the pinned legislation; OWNER_VALIDATED rules are not applied (every item « À vérifier »)', async () => {
    const posts = []; vi.stubGlobal('fetch', engine(posts));
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'AUTHORITATIVE_MODE', answers: ANSWERS } }, r);
    expect(r.statusCode).toBe(200);
    const c = r.body.citizen;
    expect(c.contract).toBe('ADA_CITIZEN_ESTIMATE_V1'); expect(c.period).toBe('2026-11'); expect(c.engine.version).toBe(OPENFISCA_FRANCE_PIN);
    const by = Object.fromEntries(c.items.map((i) => [i.code, i]));
    expect(by.prime_activite).toMatchObject({ monthlyAmount: 190, legislation: { inForceFrom: '2026-04-01' } });
    expect(by.rsa).toMatchObject({ monthlyAmount: null, amountWithheld: 'NOT_INDICATED' });
    expect(by.apl).toMatchObject({ monthlyAmount: null, amountWithheld: 'MISSING_INPUTS' });   // the questionnaire does not ask the commune
    expect(by.apl.missing).toContain('commune');
    for (const i of c.items) { expect(i.verifyWithOrganism).toBe(true); expect(['NOT_EXPERT_VALIDATED', 'NOT_IN_REGISTER']).toContain(i.ruleValidation); }
    expect(claimsEntitlement(c)).toBe(false);
    expect(r.body.estimates.d11Gate.validatedRules).toEqual([]);
    expect(r.body.estimates.d11Gate.ownerValidatedRules).toBeUndefined();
    expect(posts).toHaveLength(1);
  });

  it('privacy: nothing of the answers is logged, stored (database, quota store) or sent to Sentry — only the engine receives them', async () => {
    const posts = []; vi.stubGlobal('fetch', engine(posts));
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'AUTHORITATIVE_MODE', answers: WITH_COMMUNE } }, r);
    expect(r.statusCode).toBe(200);
    const kv = await memoryStore.read(monthKey(Date.now()));
    const kept = JSON.stringify({ logs: R.logs, sentry: R.sentry, db: R.db, kv });
    for (const v of [SENT.birthDate, String(SENT.salary), String(SENT.rent), SENT.territory, SENT.depcom, '1987', '1234', '543']) expect(kept, v).not.toContain(v);
    expect(JSON.stringify(posts)).toContain(SENT.birthDate);   // the premise: the engine did receive them
    expect(posts[0].menages.men_1.depcom).toEqual({ '2026-11': SENT.depcom });
    // and an engine failure does not echo them either
    vi.stubGlobal('fetch', vi.fn(async (u) => (String(u).endsWith('/spec') ? engine([])(u) : { ok: false, status: 500, text: async () => JSON.stringify(ANSWERS), json: async () => ({}) })));
    R.logs.length = 0; R.sentry.length = 0;
    const { default: h2 } = await import('../../api/_handlers/diagnostic.js');
    const r2 = mk(); await h2({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'AUTHORITATIVE_MODE', answers: ANSWERS } }, r2);
    expect(r2.statusCode).toBe(503);
    expect(JSON.stringify({ logs: R.logs, sentry: R.sentry, body: r2.body })).not.toContain(SENT.birthDate);
  });

  it('the commune (closed list of the Eurométropole): with it, the housing aid shows an amount within its window; any other code is refused', async () => {
    const posts = []; vi.stubGlobal('fetch', engine(posts));
    const { default: handler } = await import('../../api/_handlers/diagnostic.js');
    const r = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'AUTHORITATIVE_MODE', answers: WITH_COMMUNE } }, r);
    const by = Object.fromEntries(r.body.citizen.items.map((i) => [i.code, i]));
    expect(by.apl).toMatchObject({ monthlyAmount: 230, amountWithheld: null, legislation: { inForceFrom: '2026-10-01' }, verifyWithOrganism: true });
    expect(by.aide_logement).toMatchObject({ monthlyAmount: 230 });
    for (const depcom of ['75056', '67001x', 67482, 'AUTRE', '']) {
      const bad = mk(); await handler({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body: { mode: 'AUTHORITATIVE_MODE', answers: { ...ANSWERS, depcom } } }, bad);
      expect(bad.statusCode, String(depcom)).toBe(400); expect(bad.body.error).toBe('validation_error');
    }
    expect(posts).toHaveLength(1);
  });
});
