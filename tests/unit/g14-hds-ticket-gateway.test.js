/**
 * G14-R3 — HDS gateway of the main application: the ES256 ticket (signed by the main API, verified by the HDS service with the public key only), the
 * fail-closed switch (approval, certified-host allow-list, signing key, same provider, ported module), the Vercel routes that never serve HDS data in
 * a deployed environment, the release preflight check, and the erasure call. Synthetic keys only; the database is a proxy that fails if touched.
 */
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const touched = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { touched.n += 1; throw new Error('database touched'); } }) }));

const { generateTicketKeyPair, parseTicketPrivateKey, signHdsTicket, HDS_TICKET_CLAIMS } = await import('../../api/lib/hds-ticket.js');
const { verifyTicket, parsePublicKeys, TICKET_CLAIMS } = await import('../../services/hds/src/ticket.js');
const gw = await import('../../api/_utils/hds-gateway.js');
const { capabilityState, gateRoute, requireCapability } = await import('../../api/_utils/capabilities.js');
const { hdsGatewayCheck, evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');
const { eraseHdsSubject } = await import('../../api/lib/hds-erasure.js');
const { routes } = await import('../../api/routes.js');

const pair = generateTicketKeyPair();
const priv = /** @type {crypto.KeyObject} */ (parseTicketPrivateKey(pair.privateKeyB64));
const keys = parsePublicKeys(`k1:${pair.publicKeyB64}`);
const V = { keys, issuer: 'ada-main', audience: 'ada-hds' };
const b64u = (/** @type {any} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** a hand-made token (to forge the negative cases) */
function forge(header, claims, key = priv) {
  const h = b64u(header); const c = b64u(claims);
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${h}.${c}.${sig}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: 'ada-main', aud: 'ada-hds', sub: 'citizen-1', typ: 'citizen', caps: ['citizen.vault'], jti: 'abcdefghijklmnopqrstuv', iat: now, exp: now + 60 };

const HEX = 'b2'.repeat(32);
const TOKEN_SCALINGO = `HDS1:scalingo:CERT-38436:2028-09-11:${HEX}`;
const GATEWAY = { HDS_SERVICE_URL: gw.HDS_DEFAULT_ORIGIN, HDS_PRODUCTION_APPROVED: 'true', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: pair.privateKeyB64 };
const PROD_VAULT = { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'citizen.vault', ADA_HDS_CERTIFIED_HOSTING: TOKEN_SCALINGO, ...GATEWAY };

describe('ticket: signed by the main API, verified with the public key only', () => {
  it('round trip; the claim set is closed and identical on both sides', () => {
    const t = signHdsTicket({ sub: 'citizen-1', typ: 'citizen', caps: ['citizen.vault', 'vault.write'] }, { privateKey: priv, kid: 'k1' });
    const v = verifyTicket(t.ticket, V);
    expect(v.ok).toBe(true);
    expect(v.ok && v.claims).toMatchObject({ sub: 'citizen-1', typ: 'citizen', caps: ['citizen.vault', 'vault.write'], iss: 'ada-main', aud: 'ada-hds' });
    expect(v.ok && v.claims.exp - v.claims.iat).toBe(60);
    expect([...HDS_TICKET_CLAIMS].sort()).toEqual([...TICKET_CLAIMS].sort());
    expect(Object.keys(JSON.parse(Buffer.from(t.ticket.split('.')[1], 'base64url').toString())).every((k) => TICKET_CLAIMS.includes(k))).toBe(true);
  });
  it('refuses: wrong audience / issuer, alg none / HS256, unknown kid, another key, tampered payload, expired, too long, future, extra claim, bad jti, pro without structure', () => {
    const other = parseTicketPrivateKey(generateTicketKeyPair().privateKeyB64);
    const cases = [
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, aud: 'ada-other' }), 'TICKET_AUDIENCE'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, iss: 'someone' }), 'TICKET_ISSUER'],
      [`${b64u({ alg: 'none', kid: 'k1' })}.${b64u(good)}.AAAA`, 'TICKET_ALG'],
      [`${b64u({ alg: 'HS256', kid: 'k1' })}.${b64u(good)}.${crypto.createHmac('sha256', 'x').update('y').digest('base64url')}`, 'TICKET_ALG'],
      [forge({ alg: 'ES256', kid: 'k2' }, good), 'TICKET_KID_UNKNOWN'],
      [forge({ alg: 'ES256', kid: 'k1' }, good, other), 'TICKET_SIGNATURE'],
      [(() => { const t = forge({ alg: 'ES256', kid: 'k1' }, good).split('.'); t[1] = b64u({ ...good, sub: 'citizen-2' }); return t.join('.'); })(), 'TICKET_SIGNATURE'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, iat: now - 600, exp: now - 540 }), 'TICKET_EXPIRED'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, exp: now + 3600 }), 'TICKET_TTL'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, iat: now + 600, exp: now + 660 }), 'TICKET_NOT_YET_VALID'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, email: 'x@example.test' }), 'TICKET_CLAIMS'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, jti: 'short' }), 'TICKET_JTI'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, typ: 'pro' }), 'TICKET_STRUCTURE'],
      [forge({ alg: 'ES256', kid: 'k1' }, { ...good, typ: 'admin' }), 'TICKET_TYPE'],
      ['not.a.ticket!', 'TICKET_MALFORMED'],
    ];
    for (const [t, reason] of cases) expect(verifyTicket(/** @type {string} */ (t), V), reason).toEqual({ ok: false, reason });
  });
  it('only P-256 keys are accepted on both sides', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(parseTicketPrivateKey(rsa.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'))).toBeNull();
    expect(() => parsePublicKeys(`k1:${rsa.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`)).toThrow(/P256/);
    expect(parseTicketPrivateKey('not base64 !')).toBeNull();
  });
});

describe('gateway switch (fail-closed)', () => {
  it('allow-list: Scalingo HDS regions only, the bare suffix and custom domains are refused', () => {
    expect(gw.certifiedHostOf('ada-hds-strasbourg.osc-fr1.scalingo.io')?.provider).toBe('scalingo');
    expect(gw.certifiedHostOf('x.osc-secnum-fr1.scalingo.io')?.region).toBe('osc-secnum-fr1');
    for (const h of ['osc-fr1.scalingo.io', '.osc-fr1.scalingo.io', 'evil.com', 'a.b.osc-fr1.scalingo.io', 'osc-fr1.scalingo.io.evil.com', 'hds.accesdirectaide.fr']) expect(gw.certifiedHostOf(h), h).toBeNull();
  });
  it('deployed: every condition is necessary; the LAB accepts a loopback service without approval', () => {
    expect(gw.hdsGatewayState(GATEWAY, { deployed: true })).toMatchObject({ ready: true, origin: gw.HDS_DEFAULT_ORIGIN, provider: 'scalingo', certified: true });
    for (const [k, v, reason] of [['HDS_PRODUCTION_APPROVED', 'yes', 'HDS_PRODUCTION_NOT_APPROVED'], ['HDS_SERVICE_URL', `${gw.HDS_DEFAULT_ORIGIN}/v1`, 'HDS_SERVICE_URL_NOT_AN_ORIGIN'],
      ['HDS_SERVICE_URL', 'https://user:pw@ada-hds-strasbourg.osc-fr1.scalingo.io', 'HDS_SERVICE_URL_NOT_AN_ORIGIN'], ['HDS_TICKET_KID', 'bad kid', 'HDS_TICKET_KID_INVALID'], ['HDS_TICKET_PRIVATE_KEY', 'AAAA', 'HDS_TICKET_KEY_INVALID']]) {
      expect(gw.hdsGatewayState({ ...GATEWAY, [k]: v }, { deployed: true }).reason, `${k}=${v}`).toBe(reason);
    }
    const lab = { HDS_SERVICE_URL: 'http://127.0.0.1:4510', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: pair.privateKeyB64 };
    expect(gw.hdsGatewayState(lab, { deployed: false })).toMatchObject({ ready: true, certified: false });
    expect(gw.hdsGatewayState(lab, { deployed: true }).reason).toBe('HDS_SERVICE_URL_NOT_HTTPS');
  });
  it('capability: the vault and (G14-R4) shared dossiers open with all of it; payload capabilities need the gateway too; the LAB is unchanged', () => {
    expect(capabilityState('citizen.vault', PROD_VAULT)).toEqual({ open: true, reason: null });
    expect(capabilityState('citizen.shared_dossier', { ...PROD_VAULT, ADA_CAPABILITIES_OPEN: 'citizen.shared_dossier' })).toEqual({ open: true, reason: null });
    expect(capabilityState('citizen.shared_dossier', { ...PROD_VAULT, ADA_CAPABILITIES_OPEN: 'citizen.shared_dossier', HDS_SERVICE_URL: '' }).reason).toBe('HDS_SERVICE_URL_ABSENT');
    expect(capabilityState('pro.referrals', { ...PROD_VAULT, ADA_BETA_OPEN_SURFACES: 'documents,pro', ADA_CAPABILITIES_OPEN: 'pro.referrals', HDS_PRODUCTION_APPROVED: '' }).reason).toBe('HDS_PRODUCTION_NOT_APPROVED');
    expect(gw.HDS_MODULES).toEqual({ 'citizen.vault': 'ported', 'citizen.shared_dossier': 'ported', 'messaging.attachments': 'ported', 'pro.referrals': 'ported', 'partner.referral_adapter': 'ported', 'citizen.orientation_records': 'ported' });
    expect(capabilityState('citizen.vault', { ADA_CAPABILITY_ENFORCEMENT: '1', ADA_CAPABILITIES_OPEN: 'citizen.vault', ADA_HDS_CERTIFIED_HOSTING: TOKEN_SCALINGO }).open).toBe(true);
  });
});

const mkRes = () => ({ statusCode: 200, headers: /** @type {Record<string, string>} */ ({}), body: /** @type {any} */ (undefined),
  status(/** @type {number} */ c) { this.statusCode = c; return this; }, json(/** @type {any} */ d) { this.body = d; return this; }, setHeader(/** @type {string} */ k, /** @type {string} */ v) { this.headers[k] = v; } });

describe('Vercel never serves HDS data in a deployed environment', () => {
  it('every route of citizen.vault / citizen.shared_dossier answers 409 HDS_SERVICE_REQUIRED (or 503 closed) before its handler, whatever the body', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    for (const [k, v] of Object.entries(PROD_VAULT)) vi.stubEnv(k, v);
    vi.stubEnv('ADA_CAPABILITIES_OPEN', 'citizen.vault,citizen.shared_dossier,citizen.saved_diagnostic');
    try {
      const before = touched.n;
      for (const path of ['citizen/coffre', 'citizen/dossier', 'pro/dossier', 'share/get', 'download', 'public/passport']) {
        const r = routes.find((x) => x.path === path || path.startsWith(`${x.path}/`));
        if (!r) continue;
        const mod = await r.handler();
        const res = mkRes();
        await mod.default({ method: 'POST', url: `/api/${path}`, headers: {}, body: { fileBase64: 'Q0FOQVJZLUhFQUxUSC1QQVlMT0FE', originalName: 'CANARY-HEALTH.pdf' } }, res);
        expect([409, 503], path).toContain(res.statusCode);
        expect(JSON.stringify(res.body)).not.toMatch(/CANARY/);
        if (path === 'citizen/coffre') expect(res.body).toMatchObject({ code: 'HDS_SERVICE_REQUIRED', hdsOrigin: gw.HDS_DEFAULT_ORIGIN });
      }
      expect(touched.n).toBe(before);
      const res = mkRes();
      expect(requireCapability(res, ['citizen.vault'])).toBe(false);
      expect(res.statusCode).toBe(409);
    } finally { vi.unstubAllEnvs(); }
  });
  it('the gate wrapper is in place for the vault route (gateRoute)', () => {
    expect(typeof gateRoute).toBe('function');
    expect(routes.some((r) => r.path === 'citizen/hds-ticket')).toBe(true);
  });
});

describe('release preflight: hds.gateway', () => {
  const get = (/** @type {Record<string, string>} */ e) => (/** @type {string} */ k) => String(e[k] ?? '').trim();
  const csp = (/** @type {string} */ extra) => `"value": "default-src 'self'; connect-src 'self'${extra}; img-src 'self'"`;
  it('off = PASS; a partial configuration = FAIL naming what is missing; complete with CSP = PASS; shared dossier named = PASS (ported, G14-R4)', () => {
    expect(hdsGatewayCheck(get({}), {}, { cspText: csp('') })[0]).toBe('PASS');
    const partial = { HDS_SERVICE_URL: 'https://hds.example.com' };
    const r1 = hdsGatewayCheck(get(partial), partial, { cspText: csp('') });
    expect(r1[0]).toBe('FAIL'); expect(r1[1]).toMatch(/HDS_HOST_NOT_ON_CERTIFIED_ALLOWLIST/);
    const r2 = hdsGatewayCheck(get(PROD_VAULT), PROD_VAULT, { cspText: csp('') });
    expect(r2[0]).toBe('FAIL'); expect(r2[1]).toMatch(/connect-src/);
    expect(hdsGatewayCheck(get(PROD_VAULT), PROD_VAULT, { cspText: csp(` ${gw.HDS_DEFAULT_ORIGIN}`) })[0]).toBe('PASS');
    const wrongProvider = { ...PROD_VAULT, ADA_HDS_CERTIFIED_HOSTING: `HDS1:other-host:CERT-1:2099-12-31:${HEX}` };
    expect(hdsGatewayCheck(get(wrongProvider), wrongProvider, { cspText: csp(` ${gw.HDS_DEFAULT_ORIGIN}`) })[1]).toMatch(/provider « scalingo »/);
    const both = { ...PROD_VAULT, ADA_CAPABILITIES_OPEN: 'citizen.vault,citizen.shared_dossier' };
    expect(hdsGatewayCheck(get(both), both, { cspText: csp(` ${gw.HDS_DEFAULT_ORIGIN}`) })[0]).toBe('PASS');
    // a payload capability named without any gateway variable is no longer « off »: it FAILS until the gateway is complete
    const referralsOnly = { ADA_CAPABILITIES_OPEN: 'pro.referrals' };
    expect(hdsGatewayCheck(get(referralsOnly), referralsOnly, { cspText: csp('') })[0]).toBe('FAIL');
  });
  it('the shipped vercel.json does not yet allow the HDS origin, so a configured gateway FAILS the release until the CSP change is made', () => {
    const r = evaluateReleasePreflight(PROD_VAULT).find((c) => c.id === 'hds.gateway');
    expect(r?.status).toBe('FAIL');
    expect(evaluateReleasePreflight({}).find((c) => c.id === 'hds.gateway')?.status).toBe('PASS');
  });
});

describe('account erasure reaches the HDS service', () => {
  it('no HDS_SERVICE_URL = skipped; otherwise a system ticket (cap hds.erase, the account id only) and nothing else is sent', async () => {
    expect(await eraseHdsSubject('acc-1', { env: {} })).toEqual({ skipped: true });
    /** @type {any[]} */ const calls = [];
    const fetchImpl = /** @type {any} */ (async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ vaultDocuments: 2, dossiers: 0, blobs: 2 }), { status: 200 }); });
    const lab = { HDS_SERVICE_URL: 'http://127.0.0.1:4510', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: pair.privateKeyB64 };
    expect(await eraseHdsSubject('acc-1', { env: lab, fetchImpl })).toEqual({ skipped: false, vaultDocuments: 2, dossiers: 0, blobs: 2 });
    expect(calls[0].url).toBe('http://127.0.0.1:4510/v1/internal/erase-subject');
    expect(calls[0].init.body).toBe('{}');
    const v = verifyTicket(calls[0].init.headers.Authorization.slice(7), V);
    expect(v.ok && v.claims).toMatchObject({ sub: 'acc-1', typ: 'system', caps: ['hds.erase'] });
  });
  it('a failure stops the erasure (HDS_ERASURE_PENDING), and privacy.js calls it before the tombstone and the main erasure', async () => {
    const lab = { HDS_SERVICE_URL: 'http://127.0.0.1:4510', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: pair.privateKeyB64 };
    await expect(eraseHdsSubject('acc-1', { env: lab, fetchImpl: /** @type {any} */ (async () => new Response('{}', { status: 503 })) })).rejects.toMatchObject({ code: 'HDS_ERASURE_PENDING' });
    await expect(eraseHdsSubject('acc-1', { env: { ...lab, HDS_TICKET_PRIVATE_KEY: '' } })).rejects.toMatchObject({ code: 'HDS_ERASURE_PENDING' });
    const src = (await import('node:fs')).readFileSync('api/_services/privacy.js', 'utf8');
    const fn = src.slice(src.indexOf('async executeApprovedDeletion'));
    expect(fn.indexOf('await hdsEraser(subjectId)')).toBeGreaterThan(0);
    expect(fn.indexOf('await hdsEraser(subjectId)')).toBeLessThan(fn.indexOf('await tombstones.record(tomb)'));
    expect(fn.indexOf('await hdsEraser(subjectId)')).toBeLessThan(fn.indexOf('this.deleteDataDomains('));
  });
});
