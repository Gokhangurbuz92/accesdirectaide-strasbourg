/**
 * R45 / ENG-LR-6 — citizen-account scope limited to the AIPD by precise, auditable, server-side capability gates (api/_utils/capabilities.js), plus HDS gating.
 *   - registry: every capability says what it is, whether the AIPD covers it, whether it may need certified health-data hosting (provisional);
 *   - enforcement: ON in the beta, in production / preview, or with ADA_CAPABILITY_ENFORCEMENT=1; OFF only in development / test (the LAB full product);
 *   - opening: in-AIPD = its surface; out-of-AIPD = surface + ADA_CAPABILITIES_OPEN (exact names, no wildcard); requiresHds = + a valid HDS token;
 *   - the router refuses a closed capability for EVERY role before the handler runs (no database access, no data), the beta lifted included;
 *   - the alternate routes found by the audit (pro consent / attestation / SIAO / AI synthesis / AI agents, citizen video, shares, referrals) are covered;
 *   - Mon Espace minimisation: a closed part is neither read nor returned.
 * Synthetic data only. The database is a proxy that fails the test if touched.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const touched = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { touched.n += 1; throw new Error('database touched'); } }) }));

const caps = await import('../../api/_utils/capabilities.js');
const { CAPABILITIES, ROUTE_CAPABILITIES, CAPABILITY_NOT_OPEN, HDS_TOKEN_FORMAT, capabilitiesOfRoute, capabilityEnforced, capabilityState, hdsAttestation, gateRoute, requireCapability } = caps;
const { SURFACES, surfaceOf, isAllowedInPublicBeta } = await import('../../api/_utils/public-beta.js');
const { routes } = await import('../../api/routes.js');

const HEX = 'a1'.repeat(32);
const TOKEN = `HDS1:example-host:CERT-2026-0001:2099-12-31:${HEX}`;
const PROD = { VERCEL_ENV: 'production' };   // the beta lifted: no ADA_PUBLIC_BETA_RESTRICTED
const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
const OUT_OF_AIPD = Object.entries(CAPABILITIES).filter(([, c]) => c.aipd === 'out').map(([n]) => n);

const mkRes = () => ({ statusCode: 200, headers: /** @type {Record<string, string>} */ ({}), body: /** @type {any} */ (undefined), headersSent: false,
  status(/** @type {number} */ c) { this.statusCode = c; return this; }, json(/** @type {any} */ d) { this.body = d; this.headersSent = true; return this; },
  setHeader(/** @type {string} */ k, /** @type {string} */ v) { this.headers[k] = v; return this; }, end() { this.headersSent = true; return this; }, on() { return this; } });

afterEach(() => { vi.unstubAllEnvs(); });

describe('capability registry', () => {
  it('every capability is described, classified in / out of the AIPD, has a provisional HDS flag and a real surface', () => {
    for (const [name, c] of Object.entries(CAPABILITIES)) {
      expect(c.description.length, name).toBeGreaterThan(10);
      expect(['in', 'out'], name).toContain(c.aipd);
      expect(typeof c.requiresHds, name).toBe('boolean');
      expect(Object.keys(SURFACES), name).toContain(c.surface);
      expect(c.aipdRef, name).toBeTruthy();
      if (c.requiresHds) expect(c.aipd, `${name}: an HDS capability is never in the first opening`).toBe('out');
    }
    expect(readFileSync(resolve(process.cwd(), 'api/_utils/capabilities.js'), 'utf8')).toContain('CONTROL/r45/R45_HDS_FEATURE_MATRIX_FR.md');
  });
  it('the AIPD § 2.1 split: only the first-opening processing is « in »; every excluded family is « out »', () => {
    const IN = ['citizen.account', 'citizen.booking', 'citizen.booking_message', 'citizen.push', 'pro.account', 'pro.structure_admin', 'pro.agenda', 'pro.platform_ops', 'calendar.outlook'];
    expect(Object.entries(CAPABILITIES).filter(([, c]) => c.aipd === 'in').map(([n]) => n).sort()).toEqual(IN.sort());
    for (const n of ['citizen.orientation_records', 'pro.referrals', 'citizen.shared_dossier', 'pro.case_management', 'citizen.vault', 'citizen.saved_diagnostic',
      'diagnostic.questionnaire', 'ai.processing', 'institution.portal', 'pro.siao_interop', 'video', 'citizen.household', 'citizen.guardians', 'citizen.minor_accounts'])
      expect(CAPABILITIES[n].aipd, n).toBe('out');
    // AIPD § 11.5 and the HDS matrix: the protected services (vault, dossiers, follow-up, orientations) need certified hosting
    for (const n of ['citizen.vault', 'citizen.shared_dossier', 'pro.case_management', 'pro.referrals', 'citizen.orientation_records', 'pro.siao_interop'])
      expect(CAPABILITIES[n].requiresHds, n).toBe(true);
  });
  it('the route map names only known capabilities', () => {
    for (const [route, list] of Object.entries(ROUTE_CAPABILITIES)) for (const c of list) expect(CAPABILITIES[c], `${route} -> ${c}`).toBeTruthy();
  });
  it('every route of the accounts, appointments, pro, documents, diagnostic, institution and video surfaces carries a capability (four reviewed exceptions)', () => {
    const EXCEPTIONS = {
      pdf: 'only pdf/aides and pdf/demarches answer (published public records, open in the beta); every other pdf path is a 404',
      tts: 'retired: answers 410 (R12, P26)',
      drees: 'public reference data (DREES programme list), no personal data',
      'auth/me': 'G-3: the identity probe of every session kind — the handler answers each kind only when its own surface / capability is open (401 otherwise)',
    };
    const gated = ['accounts', 'appointments', 'pro', 'documents', 'diagnostic', 'institution', 'video'];
    const unmapped = routes.map((r) => r.path.replace(/\/$/, '')).filter((p) => gated.includes(/** @type {string} */ (surfaceOf(p))) && !capabilitiesOfRoute(p).length);
    expect(unmapped.sort()).toEqual(Object.keys(EXCEPTIONS).sort());
  });
  it('the alternate routes found by the audit map to the out-of-AIPD capability, not to the surface they live on', () => {
    expect(capabilitiesOfRoute('pro/consent')).toEqual(['citizen.shared_dossier']);
    expect(capabilitiesOfRoute('pro/attestation-data')).toEqual(['citizen.shared_dossier']);
    expect(capabilitiesOfRoute('pro/interop-siao')).toEqual(['pro.siao_interop', 'citizen.shared_dossier']);
    expect(capabilitiesOfRoute('pro/dossier-synthesis')).toEqual(['ai.processing', 'citizen.shared_dossier']);
    expect(capabilitiesOfRoute('pro/agent-discovery')).toEqual(['ai.processing']);
    expect(capabilitiesOfRoute('pro/agent-scheduler')).toEqual(['ai.processing']);
    expect(capabilitiesOfRoute('rdv/appointments/abc-123/visio')).toEqual(['video']);
    expect(capabilitiesOfRoute('rdv/appointments/abc-123/cancel')).toEqual(['citizen.booking']);
    expect(capabilitiesOfRoute('pro/appointments/visio')).toEqual(['video']);
    expect(capabilitiesOfRoute('pro/appointments/ics')).toEqual(['pro.agenda']);
    expect(capabilitiesOfRoute('citizen/shares')).toEqual(['citizen.shared_dossier']);
    expect(capabilitiesOfRoute('citizen/referrals')).toEqual(['citizen.orientation_records']);
    expect(capabilitiesOfRoute('share/create')).toEqual(['citizen.saved_diagnostic', 'citizen.shared_dossier']);
    expect(capabilitiesOfRoute('download')).toEqual(['citizen.shared_dossier']);
    expect(capabilitiesOfRoute('aides/rsa')).toEqual([]);
  });
});

describe('enforcement: on in the beta, production and preview; off only in development / test', () => {
  it('follows the lead rule exactly', () => {
    expect(capabilityEnforced({})).toBe(false);
    expect(capabilityEnforced({ VERCEL_ENV: 'development', NODE_ENV: 'test' })).toBe(false);
    expect(capabilityEnforced(BETA)).toBe(true);
    expect(capabilityEnforced({ VERCEL_ENV: 'production' })).toBe(true);
    expect(capabilityEnforced({ VERCEL_ENV: ' Preview ' })).toBe(true);
    expect(capabilityEnforced({ ADA_CAPABILITY_ENFORCEMENT: '1' })).toBe(true);
    for (const v of ['true', 'yes', 'on', '2', ' ']) expect(capabilityEnforced({ ADA_CAPABILITY_ENFORCEMENT: v }), v).toBe(false);
  });
  it('no value turns it off in production or preview', () => {
    for (const v of ['0', 'false', 'off', '']) {
      expect(capabilityEnforced({ VERCEL_ENV: 'production', ADA_CAPABILITY_ENFORCEMENT: v }), v).toBe(true);
      expect(capabilityEnforced({ VERCEL_ENV: 'preview', ADA_CAPABILITY_ENFORCEMENT: v }), v).toBe(true);
      expect(capabilityState('citizen.vault', { VERCEL_ENV: 'production', ADA_CAPABILITY_ENFORCEMENT: v }).open, v).toBe(false);
    }
  });
  it('in the LAB (enforcement off) everything known is open — the full product keeps running; an unknown name never is', () => {
    for (const n of Object.keys(CAPABILITIES)) expect(capabilityState(n, {}).open, n).toBe(true);
    expect(capabilityState('citizen.everything', {}).open).toBe(false);
  });
});

describe('opening rule (fail-closed)', () => {
  it('production with the beta lifted: in-AIPD open, every out-of-AIPD capability closed by default', () => {
    for (const [n, c] of Object.entries(CAPABILITIES)) expect(capabilityState(n, PROD).open, n).toBe(c.aipd === 'in');
  });
  it('ADA_CAPABILITIES_OPEN opens a non-HDS capability; exact names only, no wildcard, case and spaces tolerated', () => {
    expect(capabilityState('pro.orientation_selections', { ...PROD, ADA_CAPABILITIES_OPEN: 'pro.orientation_selections' }).open).toBe(true);
    expect(capabilityState('citizen.household', { ...PROD, ADA_CAPABILITIES_OPEN: ' Citizen.Household , foo' }).open).toBe(true);
    for (const v of ['*', 'all', 'citizen.*', 'citizen', 'household', 'citizen.household2', ' , ', 'true', '1'])
      expect(capabilityState('citizen.household', { ...PROD, ADA_CAPABILITIES_OPEN: v }).open, v).toBe(false);
    expect(capabilityState('citizen.household', { ...PROD, ADA_CAPABILITIES_OPEN: 'citizen.favorites' }).reason).toBe('NOT_LISTED_IN_ADA_CAPABILITIES_OPEN');
  });
  it('a requiresHds capability ALSO needs a valid, unexpired HDS attestation token', () => {
    const env = { ...PROD, ADA_CAPABILITIES_OPEN: 'citizen.vault,pro.case_management' };
    expect(capabilityState('citizen.vault', env)).toEqual({ open: false, reason: 'HDS_HOSTING_NOT_ATTESTED' });
    expect(capabilityState('citizen.vault', { ...env, ADA_HDS_CERTIFIED_HOSTING: TOKEN }).open).toBe(true);
    expect(capabilityState('pro.case_management', { ...env, ADA_HDS_CERTIFIED_HOSTING: TOKEN }).open).toBe(true);
    // the token alone opens nothing
    expect(capabilityState('citizen.vault', { ...PROD, ADA_HDS_CERTIFIED_HOSTING: TOKEN }).open).toBe(false);
  });
  it('HDS follows the matrix (R45_HDS_FEATURE_MATRIX_FR.md § 3): vault, dossiers, referrals required; ProCase depends on the structure and fails closed when unknown', () => {
    expect(CAPABILITIES['citizen.saved_diagnostic'].requiresHds).toBe(false);   // row 11: uncertain, leaning no (still closed: outside the AIPD)
    expect(CAPABILITIES['pro.case_management'].hdsDependsOnStructure).toBe(true);
    expect(Object.entries(CAPABILITIES).filter(([, c]) => c.hdsDependsOnStructure).map(([n]) => n)).toEqual(['pro.case_management']);
    const env = { ...PROD, ADA_CAPABILITIES_OPEN: 'pro.case_management' };
    for (const cat of [undefined, 'UNKNOWN', 'ESSMS', 'HEALTH', 'not_essms', 'anything'])
      expect(capabilityState('pro.case_management', env, { structureCategory: /** @type {any} */ (cat) }).reason, String(cat)).toBe('HDS_HOSTING_NOT_ATTESTED');
    expect(capabilityState('pro.case_management', env, { structureCategory: 'NOT_ESSMS' }).open).toBe(true);
    // a structure-independent HDS capability is never waived by a structure category
    expect(capabilityState('citizen.vault', { ...PROD, ADA_CAPABILITIES_OPEN: 'citizen.vault' }, { structureCategory: 'NOT_ESSMS' }).open).toBe(false);
    // the route gate knows no structure: the case route stays closed without a token
    expect(capabilityState('pro.case_management', env).open).toBe(false);
    // there is no platform-wide « HDS everything » switch: only the token, per capability
    expect(readFileSync(resolve(process.cwd(), 'api/_utils/capabilities.js'), 'utf8')).not.toMatch(/ADA_HDS_ALL|HDS_EVERYTHING|ADA_HDS_REQUIRED/);
  });
  it('the HDS token format is exact; malformed, impossible or past dates are refused', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    expect(hdsAttestation({ ADA_HDS_CERTIFIED_HOSTING: TOKEN }, now)).toEqual({ valid: true, reason: null });
    expect(hdsAttestation({}, now).reason).toBe('HDS_ATTESTATION_ABSENT');
    for (const bad of ['1', 'true', 'yes', 'HDS1', `HDS2:example-host:CERT-1:2099-12-31:${HEX}`, `HDS1:Example:CERT-1:2099-12-31:${HEX}`,
      `HDS1:example-host:CERT-1:2099-12-31:${HEX.toUpperCase()}`, `HDS1:example-host:CERT-1:2099-12-31:${HEX.slice(2)}`, `HDS1:example-host:CERT-1:31-12-2099:${HEX}`,
      `HDS1:example-host:CERT-1:2099-02-30:${HEX}`, `HDS1:example-host::2099-12-31:${HEX}`])
      expect(hdsAttestation({ ADA_HDS_CERTIFIED_HOSTING: bad }, now).valid, bad).toBe(false);
    expect(hdsAttestation({ ADA_HDS_CERTIFIED_HOSTING: `HDS1:example-host:CERT-1:2026-11-04:${HEX}` }, now).reason).toBe('HDS_ATTESTATION_EXPIRED');
    expect(hdsAttestation({ ADA_HDS_CERTIFIED_HOSTING: `HDS1:example-host:CERT-1:2026-11-05:${HEX}` }, now).valid).toBe(true);   // valid through that day
    expect(HDS_TOKEN_FORMAT.test(TOKEN)).toBe(true);
    // the manifest format accepts the same token (and the empty value)
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'config/activation-manifest.json'), 'utf8'));
    expect(new RegExp(manifest.variables.ADA_HDS_CERTIFIED_HOSTING.format).test(TOKEN)).toBe(true);
    expect(new RegExp(manifest.variables.ADA_HDS_CERTIFIED_HOSTING.format).test('yes')).toBe(false);
  });
  it('during the beta the capability’s surface must be open too (and the full accounts scope for the citizen-space extras)', () => {
    const listed = { ...BETA, ADA_CAPABILITIES_OPEN: 'citizen.household,citizen.vault', ADA_HDS_CERTIFIED_HOSTING: TOKEN };
    expect(capabilityState('citizen.household', listed).reason).toBe('SURFACE_CLOSED');
    expect(capabilityState('citizen.household', { ...listed, ADA_BETA_OPEN_SURFACES: 'accounts' }).reason).toBe('SURFACE_CLOSED');   // narrow scope
    expect(capabilityState('citizen.household', { ...listed, ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_SCOPE: 'full' }).open).toBe(true);
    expect(capabilityState('citizen.vault', { ...listed, ADA_BETA_OPEN_SURFACES: 'accounts' }).reason).toBe('SURFACE_CLOSED');
    expect(capabilityState('citizen.vault', { ...listed, ADA_BETA_OPEN_SURFACES: 'documents' }).open).toBe(true);
    expect(capabilityState('citizen.account', { ...BETA, ADA_BETA_OPEN_SURFACES: 'accounts' }).open).toBe(true);
    expect(capabilityState('citizen.booking', { ...BETA, ADA_BETA_OPEN_SURFACES: 'accounts' }).open).toBe(false);
  });
  it('minors’ independent accounts never open by a switch', () => {
    expect(capabilityState('citizen.minor_accounts', { ...PROD, ADA_CAPABILITIES_OPEN: 'citizen.minor_accounts', ADA_HDS_CERTIFIED_HOSTING: TOKEN }).reason).toBe('NOT_OPENABLE');
  });
  it('« ADA_BETA_ACCOUNTS_SCOPE=full » keeps its surface meaning (R43 tests) but no longer opens an out-of-AIPD capability by itself', () => {
    const full = { ...BETA, ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_SCOPE: 'full' };
    expect(isAllowedInPublicBeta('GET', 'citizen/referrals', full)).toBe(true);   // surface layer (unchanged)
    expect(capabilityState('citizen.orientation_records', full).open).toBe(false);   // capability layer
    expect(capabilityState('citizen.push', full).open).toBe(true);   // in the AIPD (P10)
  });
});

/** synthetic sessions of every role (the gate never reads them: it must refuse them all alike) */
let ROLE_HEADERS = /** @type {Record<string, Record<string, string>>} */ ({});
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'j'.repeat(40)); vi.stubEnv('AUTH_SECRET', 's'.repeat(40));
  const userAuth = await import('../../api/_utils/user-auth.js');
  const auth = await import('../../api/_utils/auth.js');
  const pro = (/** @type {string} */ role, /** @type {boolean} */ mfa) => `Bearer ${auth.signProToken({ id: `pro-${role}`, email: `${role.toLowerCase()}+r45@example.test`, structureId: 'structure-r45', role }, { mfa })}`;
  ROLE_HEADERS = {
    anonymous: {},
    citizen: { cookie: `ada_user_session=${userAuth.signUserSessionToken({ userId: 'citizen-r45', email: 'test.citizen+r45@example.test' })}` },
    'professional without MFA': { authorization: pro('PRO', false) },
    'professional with MFA': { authorization: pro('PRO', true) },
    'structure admin': { authorization: pro('STRUCTURE_ADMIN', true) },
    administrator: { cookie: `ada_admin_session=${auth.signAdminSessionToken({ role: 'ADMIN', email: 'admin+r45@example.test', mfa_verified: true })}` },
  };
  vi.unstubAllEnvs();
});

const routeFor = (/** @type {string} */ p) => {
  const r = routes.find((x) => (x.match === 'exact' ? x.path === p : p === x.path.replace(/\/$/, '') || p.startsWith(x.path.endsWith('/') ? x.path : `${x.path}/`)));
  if (!r) throw new Error(`no route ${p}`);
  return r;
};
/** call a route through the router table (the gate + the real handler) */
async function callRoute(/** @type {string} */ method, /** @type {string} */ p, /** @type {Record<string, string>} */ headers, /** @type {Record<string, string>} */ env) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.stubEnv('JWT_SECRET', 'j'.repeat(40)); vi.stubEnv('AUTH_SECRET', 's'.repeat(40));
  const before = touched.n;
  const res = mkRes();
  const mod = await routeFor(p).handler();
  try { await mod.default({ method, url: `/api/${p}`, query: {}, body: {}, headers: { host: 'localhost', ...headers }, socket: { remoteAddress: '203.0.113.45' } }, res); } catch (e) { res.body = { threw: String(/** @type {Error} */ (e).message) }; }
  vi.unstubAllEnvs();
  return { status: res.statusCode, body: res.body, dbTouched: touched.n > before, cache: res.headers['Cache-Control'] };
}

// out-of-AIPD routes, alternate paths of the audit included (one per capability family)
const LEAK_ROUTES = [
  ['GET', 'citizen/coffre'], ['GET', 'citizen/dossier'], ['GET', 'citizen/shares'], ['GET', 'citizen/referrals'], ['GET', 'citizen/household'], ['GET', 'citizen/guardians'],
  ['GET', 'citizen/parcours'], ['GET', 'citizen/favorites'], ['GET', 'citizen/history'], ['GET', 'citizen/delegations'],
  ['GET', 'pro/cases'], ['GET', 'pro/referrals'], ['GET', 'pro/selections'], ['POST', 'pro/consent'], ['GET', 'pro/attestation-data'], ['POST', 'pro/interop-siao'],
  ['POST', 'pro/dossier-synthesis'], ['POST', 'pro/agent-discovery'], ['POST', 'pro/agent-scheduler'], ['GET', 'pro/dossier'], ['GET', 'pro/dossier/export'],
  ['POST', 'pro/appointments/visio'], ['POST', 'rdv/appointments/a1b2c3/visio'],
  ['GET', 'share/get'], ['POST', 'share/create'], ['GET', 'public/passport'], ['GET', 'public/dossier-grants'], ['GET', 'download'],
  ['POST', 'diagnostic'], ['POST', 'assistant/chat'], ['POST', 'public/assistant/orient'], ['POST', 'public/falc/summarize'],
  ['POST', 'institution/login'], ['GET', 'admin/institutions'],
];

describe('router gate: refused for every role, before the handler, without data', () => {
  it.each(Object.keys({ anonymous: 1, citizen: 1, 'professional without MFA': 1, 'professional with MFA': 1, 'structure admin': 1, administrator: 1 }))(
    'production, beta lifted: %s gets 503 CAPABILITY_NOT_OPEN on every out-of-AIPD route, and nothing is read', async (role) => {
      for (const [m, p] of LEAK_ROUTES) {
        const r = await callRoute(m, p, ROLE_HEADERS[role], PROD);
        expect(r.status, `${role} ${m} ${p}`).toBe(503);
        expect(r.body.code, `${role} ${m} ${p}`).toBe(CAPABILITY_NOT_OPEN);
        expect(Object.keys(r.body).sort(), p).toEqual(['capability', 'code', 'error', 'message']);   // no data
        expect(r.dbTouched, `${role} ${p}: database touched`).toBe(false);
        expect(r.cache).toBe('no-store');
      }
    }, 60000);
  it('the same in preview, in the beta (surface opened) and with ADA_CAPABILITY_ENFORCEMENT=1', async () => {
    for (const env of [{ VERCEL_ENV: 'preview' }, { ...BETA, ADA_BETA_OPEN_SURFACES: 'accounts,pro,appointments,documents,diagnostic,institution,video,admin', ADA_BETA_ACCOUNTS_SCOPE: 'full' },
      { ADA_CAPABILITY_ENFORCEMENT: '1' }, { VERCEL_ENV: 'production', ADA_CAPABILITY_ENFORCEMENT: '0' }]) {
      for (const [m, p] of LEAK_ROUTES) expect((await callRoute(m, p, ROLE_HEADERS.citizen, env)).body?.code, `${JSON.stringify(env)} ${p}`).toBe(CAPABILITY_NOT_OPEN);
    }
  }, 60000);
  it('in-AIPD routes are not touched by the gate: the handler answers (here, its own authentication refusal)', async () => {
    for (const [m, p] of [['GET', 'citizen/espace'], ['GET', 'citizen/profile'], ['GET', 'rdv/appointments'], ['GET', 'pro/slots'], ['GET', 'pro/me'], ['GET', 'auth/export-data']]) {
      const r = await callRoute(m, p, ROLE_HEADERS.anonymous, PROD);
      expect(r.body?.code, p).not.toBe(CAPABILITY_NOT_OPEN);
      expect(r.status, p).not.toBe(503);
    }
  });
  it('the LAB (development / test, no switch) is unchanged: the gate lets every route through to its handler', async () => {
    for (const [m, p] of LEAK_ROUTES) expect((await callRoute(m, p, ROLE_HEADERS.anonymous, {})).body?.code, p).not.toBe(CAPABILITY_NOT_OPEN);
  }, 60000);
  it('opened by the owner switches, the route reaches its handler again (which still applies its own authentication)', async () => {
    const open = { ...PROD, ADA_CAPABILITIES_OPEN: 'pro.orientation_selections,pro.case_management', ADA_HDS_CERTIFIED_HOSTING: TOKEN };
    for (const p of ['pro/selections', 'pro/cases']) {
      const r = await callRoute('GET', p, ROLE_HEADERS.anonymous, open);
      expect(r.body?.code, p).not.toBe(CAPABILITY_NOT_OPEN);
      expect(r.status, p).toBe(401);
    }
    // HDS capability listed without the token: still closed
    expect((await callRoute('GET', 'pro/cases', ROLE_HEADERS['structure admin'], { ...PROD, ADA_CAPABILITIES_OPEN: 'pro.case_management' })).body.code).toBe(CAPABILITY_NOT_OPEN);
  });
  it('gateRoute keeps the module’s named exports and refuses before the inner handler runs', async () => {
    const inner = vi.fn(async (/** @type {any} */ _q, /** @type {any} */ res) => res.status(200).json({ data: 'secret-row' }));
    const r = gateRoute({ path: 'pro/cases', match: 'exact', handler: async () => ({ default: inner, helper: 42 }) });
    const mod = await r.handler();
    expect(mod.helper).toBe(42);
    vi.stubEnv('VERCEL_ENV', 'production');
    const res = mkRes(); await mod.default({ method: 'GET', url: '/api/pro/cases', headers: {} }, res);
    expect(res.statusCode).toBe(503); expect(JSON.stringify(res.body)).not.toContain('secret-row'); expect(inner).not.toHaveBeenCalled();
  });
});

describe('handler-level guards (the same rule inside the handlers, for any caller that bypasses the router)', () => {
  it('requireCapability answers 503 and returns false only when a named capability is closed', () => {
    const res = mkRes();
    expect(requireCapability(res, ['citizen.account', 'citizen.vault'], PROD)).toBe(false);
    expect(res.statusCode).toBe(503); expect(res.body).toMatchObject({ code: CAPABILITY_NOT_OPEN, capability: 'citizen.vault' });
    expect(requireCapability(mkRes(), 'citizen.account', PROD)).toBe(true);
    expect(requireCapability(mkRes(), [], PROD)).toBe(true);
  });
  it.each([
    ['citizen/coffre.js', 'GET'], ['citizen/referrals.js', 'GET'], ['citizen/household.js', 'GET'], ['pro/cases.js', 'GET'], ['pro/referrals.js', 'GET'],
    ['pro/orientation-baskets.js', 'GET'], ['pro/interop-siao.js', 'POST'], ['pro/dossier-synthesis.js', 'POST'], ['pro/agent-discovery.js', 'POST'],
    ['pro/consent.js', 'POST'], ['pro/attestation-data.js', 'GET'], ['pro/appointments/visio.js', 'POST'], ['institution.js', 'POST'],
  ])('%s refuses directly (production, beta lifted)', async (file, method) => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('JWT_SECRET', 'j'.repeat(40)); vi.stubEnv('AUTH_SECRET', 's'.repeat(40));
    const { default: h } = await import(`../../api/_handlers/${file}`);
    const before = touched.n; const res = mkRes();
    await h({ method, url: `/api/${file.replace(/\.js$/, '')}`, query: {}, body: {}, headers: { host: 'localhost', ...ROLE_HEADERS['structure admin'] }, socket: { remoteAddress: '203.0.113.46' } }, res);
    expect(res.body?.code, `${file} ${res.statusCode} ${JSON.stringify(res.body)}`).toBe(CAPABILITY_NOT_OPEN);
    expect(touched.n, file).toBe(before);
  });
  it('the citizen video route: the router refuses it whole; inside the booking handler a NEW video agreement is refused, a withdrawal never is', async () => {
    expect((await callRoute('POST', 'rdv/appointments/a1/visio', ROLE_HEADERS.citizen, PROD)).body.code).toBe(CAPABILITY_NOT_OPEN);
    const src = readFileSync(resolve(process.cwd(), 'api/_handlers/rdv.js'), 'utf8');
    expect(src).toMatch(/if \(action === 'consent'\) \{ const \{ requireCapability \} = await import\('\.\.\/_utils\/capabilities\.js'\); if \(!requireCapability\(res, 'video'\)\) return undefined; \}/);
  });
});

describe('video: a configured, approved provider is still not offered while the capability is closed', () => {
  const ON = { VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'video.example.org', VIDEO_JITSI_APP_ID: 'ada', VIDEO_JITSI_SECRET: 's'.repeat(32), VERCEL_ENV: 'production', VIDEO_PRODUCTION_APPROVED: 'true' };
  it('publicVideoStatus and joinRefusal follow the capability', async () => {
    const { publicVideoStatus, joinRefusal, videoStatus } = await import('../../api/lib/video-provider.js');
    expect(videoStatus(ON).bookable).toBe(true);   // the provider configuration itself (pkg3 tests)
    expect(publicVideoStatus(ON)).toMatchObject({ available: false, reason: 'CAPABILITY_NOT_OPEN' });
    expect(publicVideoStatus({ ...ON, ADA_CAPABILITIES_OPEN: 'video' })).toMatchObject({ available: true });
    const now = new Date('2030-01-01T10:00:00Z');
    const appt = { mode: 'VIDEO', status: 'confirmed', visioApprovedAt: now, visioRoomId: 'n', visioCitizenConsentAt: now, startAt: '2030-01-01T10:05:00Z', endAt: '2030-01-01T10:35:00Z' };
    expect(joinRefusal(appt, { now, env: ON })?.code).toBe(CAPABILITY_NOT_OPEN);
    expect(joinRefusal(appt, { now, env: { ...ON, ADA_CAPABILITIES_OPEN: 'video' } })).toBeNull();
    const { offeredModes } = await import('../../api/lib/appointment-modes.js');
    expect(offeredModes('BOTH', ['IN_PERSON', 'VIDEO'], publicVideoStatus(ON))).toEqual(['IN_PERSON']);
  });
});

describe('Mon Espace summary minimisation', () => {
  /** a recording stand-in for the database: the SQL text of every query, rows chosen by table */
  function fakeDb() {
    const seen = /** @type {string[]} */ ([]);
    const text = (/** @type {any} */ q) => JSON.stringify(q?.queryChunks?.map((/** @type {any} */ c) => c?.value ?? (c?.constructor?.name === 'PgTable' ? '' : '')) ?? '');
    const chain = (/** @type {string} */ table) => { const c = /** @type {any} */ ({ from: () => c, where: () => c, orderBy: () => c, limit: () => Promise.resolve([]), then: (/** @type {any} */ f) => Promise.resolve([]).then(f) }); seen.push(table); return c; };
    return {
      seen,
      execute: async (/** @type {any} */ q) => { const t = text(q); seen.push(t); return { rows: [/RdvConversation/.test(t) ? { conversations: 2, lastAt: null, lastSender: 'PRO' } : { f: 7, s: 3 }] }; },
      select: () => ({ from: (/** @type {any} */ tbl) => { const name = String(tbl?.[Symbol.for('drizzle:Name')] || 'table'); return chain(name).from(); } }),
    };
  }
  it('closed parts are neither read nor returned (no count, no flag, no key)', async () => {
    const { espaceSummary } = await import('../../api/_services/mon-espace.js');
    const db = fakeDb();
    const out = await espaceSummary('citizen-r45', db, { isOpen: (c) => ['citizen.booking', 'citizen.booking_message'].includes(c) });
    expect(Object.keys(out.summary).sort()).toEqual(['messages', 'nextAppointment']);
    expect(out.summary.messages).toMatchObject({ conversations: 2, lastFromStructure: true });
    const all = db.seen.join(' ');
    for (const t of ['CitizenFavorite', 'SharedDiagnostic', 'ParcoursItem', 'CitizenDocument']) expect(all, t).not.toContain(t);
  });
  it('production with the beta lifted: the default rule keeps only the booking parts', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { espaceSummary } = await import('../../api/_services/mon-espace.js');
    const out = await espaceSummary('citizen-r45', fakeDb());
    expect(Object.keys(out.summary).sort()).toEqual(['messages', 'nextAppointment']);
  });
  it('an opened capability brings its part back', async () => {
    const { espaceSummary } = await import('../../api/_services/mon-espace.js');
    const out = await espaceSummary('citizen-r45', fakeDb(), { isOpen: (c) => ['citizen.favorites', 'citizen.shared_dossier'].includes(c) });
    expect(out.summary).toEqual({ favorites: 7, dossiers: 3 });
  });
});

describe('release gate and readiness doctor name the capability state (never a value)', () => {
  it('release preflight: PASS when nothing outside the AIPD is named, WARN when named, FAIL for a malformed HDS token', async () => {
    const { evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');
    const st = (/** @type {Record<string, string>} */ env, /** @type {string} */ id) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((r) => r.id === id);
    expect(st({}, 'capabilities.out_of_aipd')?.status).toBe('PASS');
    expect(st({ ADA_CAPABILITIES_OPEN: 'citizen.vault' }, 'capabilities.out_of_aipd')).toMatchObject({ status: 'WARN', detail: expect.stringContaining('named but still closed: citizen.vault') });
    expect(st({ ADA_CAPABILITIES_OPEN: 'citizen.household' }, 'capabilities.out_of_aipd')?.detail).toContain('open: citizen.household');
    expect(st({ ADA_CAPABILITIES_OPEN: '*' }, 'capabilities.out_of_aipd')?.detail).toContain('unknown names (open nothing): *');
    expect(st({ ADA_HDS_CERTIFIED_HOSTING: 'yes' }, 'capabilities.hds_attestation')?.status).toBe('FAIL');
    expect(JSON.stringify(st({ ADA_HDS_CERTIFIED_HOSTING: TOKEN }, 'capabilities.hds_attestation'))).not.toContain(HEX);
    expect(st({}, 'capabilities.hds_attestation')).toBeUndefined();
  });
  it('feature readiness: a module whose routes need a closed capability is PRODUCTION_RESTRICTED with the reason', async () => {
    const { loadManifest, evaluateReadiness } = await import('../../scripts/feature-readiness.mjs');
    const root = process.cwd(); const manifest = loadManifest(root);
    const m = manifest.modules.find((/** @type {any} */ x) => (x.routes || []).includes('pro/cases'));
    expect(m).toBeTruthy();
    const out = evaluateReadiness({ root, manifest, source: { mode: 'values', env: {} } });
    expect(out.modules[m.id].capabilities).toContain('pro.case_management');
    expect([...out.modules[m.id].blockers, ...out.modules[m.id].also].join(' ')).toContain('capability pro.case_management closed in production');
  });
});

describe('closed is not removed: every out-of-AIPD handler stays routed', () => {
  it('each out-of-AIPD capability has at least one routed path, or is a registry-only switch', () => {
    const REGISTRY_ONLY = ['citizen.minor_accounts'];
    for (const n of OUT_OF_AIPD) {
      if (REGISTRY_ONLY.includes(n)) continue;
      const routed = routes.some((r) => capabilitiesOfRoute(r.path.replace(/\/$/, '')).includes(n) || (n === 'video' && r.path === 'rdv'));
      expect(routed, n).toBe(true);
    }
  });
});
