/**
 * R40 security — ADA Pro second factor and session lifetime:
 *  - the pending sign-in token has its own issuer/audience and a jti (an unscoped HS256 token, or a session token, is not one); codes are limited per
 *    account and per pending token, not only per address;
 *  - enrolment is refused once MFA is on, counts against the same per-account limit, and ends every earlier session;
 *  - a session token needs issuer and audience (no legacy fallback); a refresh carries the sign-in time and stops after PRO_SESSION_MAX_AGE_SECONDS, and
 *    does not extend a password-only session of an account that has MFA.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = 'j'.repeat(40);
const saved = { ...process.env };
const state = { user: null, membership: null, updates: [], limits: [], refuse: new Set(), audits: [] };
const mk = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, { JWT_SECRET: SECRET });
  Object.assign(state, { user: null, membership: null, updates: [], limits: [], refuse: new Set(), audits: [] });
  vi.doMock('../../src/db/index.js', () => ({ db: {
    query: { ProUser: { findFirst: async () => state.user }, AuthToken: { findFirst: async () => null } },
    update: () => ({ set: (v) => ({ where: async () => { state.updates.push(v); } }) }),
    insert: () => ({ values: async (v) => { state.audits.push(v.action); } }),
    execute: async () => ({ rows: state.membership ? [state.membership] : [] }),
  } }));
  vi.doMock('../../api/_utils/rateLimit.js', () => ({
    checkRateLimit: vi.fn(async (action, key) => { state.limits.push(`${action}|${key}`); return { allowed: !state.refuse.has(action) }; }),
    getClientIp: () => '203.0.113.9', getRateLimitStatus: () => 429,
  }));
  vi.doMock('../../api/_utils/totp-guard.js', () => ({ claimProStep: async () => true, openMfaSecret: (s) => s, sealMfaSecret: (s) => s, isVaultReady: () => true }));
  vi.doMock('../../api/lib/totp.js', () => ({ matchCodeStep: (_s, code) => (code === '123456' ? 1 : null), generateSecret: () => 'S', buildOtpauthUrl: () => 'otpauth://x' }));
});
afterEach(() => { process.env = { ...saved }; vi.resetModules(); for (const m of ['../../src/db/index.js', '../../api/_utils/rateLimit.js', '../../api/_utils/totp-guard.js', '../../api/lib/totp.js']) vi.doUnmock(m); });

const PRO = { id: 'u1', email: 'pro@example.test', structureId: 's1', role: 'PRO' };
const verifyCall = async (mfa_token, code = '123456') => { const h = (await import('../../api/_handlers/pro/auth/mfa-verify.js')).default; const r = mk(); await h({ method: 'POST', url: '/api/pro/auth/mfa-verify', headers: {}, query: {}, body: { mfa_token, code } }, r); return r; };

describe('pending sign-in token and mfa-verify', () => {
  it('an unscoped legacy-format pending token and a session token are refused; the pending token is never a session', async () => {
    const auth = await import('../../api/_utils/auth.js');
    state.user = { ...PRO, mfa_enabled: true, mfa_secret: 'S' };
    const legacy = jwt.sign({ userId: 'u1', email: PRO.email, structureId: 's1', scope: 'mfa_pending' }, SECRET, { expiresIn: '5m', algorithm: 'HS256' });
    expect((await verifyCall(legacy)).statusCode).toBe(401);
    expect((await verifyCall(auth.signProToken(PRO))).statusCode).toBe(401);
    const pending = auth.signProMfaPendingToken(PRO);
    expect(auth.verifyProToken(pending)).toBeNull();
    expect(jwt.decode(pending)).toMatchObject({ iss: 'accesdirectaide', aud: 'accesdirectaide-pro-mfa', scope: 'mfa_pending' });
    expect(typeof jwt.decode(pending).jti).toBe('string');
    expect((await verifyCall(pending)).statusCode).toBe(200);
  });
  it('codes are limited per account and per pending token, and the account limit answers 429', async () => {
    const auth = await import('../../api/_utils/auth.js');
    state.user = { ...PRO, mfa_enabled: true, mfa_secret: 'S' };
    const pending = auth.signProMfaPendingToken(PRO);
    await verifyCall(pending, '000000');
    const jti = jwt.decode(pending).jti;
    expect(state.limits).toEqual(expect.arrayContaining(['MFA_VERIFY_PRO_USER|user:u1', `MFA_VERIFY_PRO_TOKEN|jti:${jti}`]));
    state.refuse.add('MFA_VERIFY_PRO_USER');
    const r = await verifyCall(pending);
    expect(r.statusCode).toBe(429);
    expect(r.body?.token).toBeUndefined();
  });
});

describe('pro enrolment (POST /api/pro/mfa-setup)', () => {
  const setupCall = async (code = '123456') => {
    const auth = await import('../../api/_utils/auth.js');
    const h = (await import('../../api/_handlers/pro/mfa-setup.js')).default; const r = mk();
    await h({ method: 'POST', url: '/api/pro/mfa-setup', headers: { authorization: `Bearer ${auth.signProToken(PRO)}` }, query: {}, body: { code } }, r);
    return r;
  };
  it('is refused with 409 while MFA is already on (no new token)', async () => {
    state.user = { ...PRO, mfa_enabled: true, mfa_secret: 'S' };
    const r = await setupCall();
    expect(r.statusCode).toBe(409);
    expect(r.body.token).toBeUndefined();
    expect(state.updates).toEqual([]);
  });
  it('counts against the per-account limit (429) and a wrong code is audited', async () => {
    state.user = { ...PRO, mfa_enabled: false, mfa_secret: 'S' };
    expect((await setupCall('000000')).statusCode).toBe(400);
    expect(state.limits).toContain('MFA_VERIFY_PRO_USER|user:u1');
    expect(state.audits).toContain('MFA_ENROL_FAILED');
    state.refuse.add('MFA_VERIFY_PRO_USER');
    expect((await setupCall()).statusCode).toBe(429);
    expect(state.updates).toEqual([]);
  });
  it('enabling MFA ends earlier sessions and returns a fresh session with the second factor', async () => {
    state.user = { ...PRO, mfa_enabled: false, mfa_secret: 'S' };
    const r = await setupCall();
    expect(r.statusCode).toBe(200);
    expect(state.updates[0]).toMatchObject({ mfa_enabled: true });
    expect(state.updates[0].sessionsValidAfter).toBeInstanceOf(Date);
    const auth = await import('../../api/_utils/auth.js');
    const claims = auth.verifyProToken(r.body.token);
    expect(claims.mfa).toBe(true);
    expect(auth.proSessionRevoked(claims.iat, { sessionsValidAfter: state.updates[0].sessionsValidAfter })).toBe(false);
  });
});

describe('pro session tokens and refresh', () => {
  const refreshCall = async (token) => { const h = (await import('../../api/_handlers/pro/auth/refresh.js')).default; const r = mk(); await h({ method: 'POST', url: '/api/pro/auth/refresh', headers: { authorization: `Bearer ${token}` }, query: {}, body: {} }, r); return r; };
  it('a token without issuer and audience is not a session', async () => {
    const auth = await import('../../api/_utils/auth.js');
    expect(auth.verifyProToken(jwt.sign({ userId: 'u1', structureId: 's1', role: 'PRO', scope: 'pro' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' }))).toBeNull();
    expect(auth.verifyProToken(jwt.sign({ userId: 'u1', structureId: 's1', role: 'PRO' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' }))).toBeNull();
  });
  it('a refresh keeps the sign-in time and is refused once the session is older than the maximum age', async () => {
    const auth = await import('../../api/_utils/auth.js');
    state.membership = { role: 'PRO', status: 'active', structureId: 's1', sessionsValidAfter: null, mfa_enabled: false };
    const signedIn = Math.floor(Date.now() / 1000) - 3600;
    const ok = await refreshCall(auth.signProToken({ ...PRO, authTime: signedIn }));
    expect(ok.statusCode).toBe(200);
    expect(jwt.decode(ok.body.token).auth_time).toBe(signedIn);
    const old = await refreshCall(auth.signProToken({ ...PRO, authTime: Math.floor(Date.now() / 1000) - auth.PRO_SESSION_MAX_AGE_SECONDS - 60 }));
    expect([old.statusCode, old.body.code]).toEqual([401, 'SESSION_MAX_AGE']);
  });
  it('a password-only session of an account with MFA enabled is not extended; a session with the second factor is', async () => {
    const auth = await import('../../api/_utils/auth.js');
    state.membership = { role: 'PRO', status: 'active', structureId: 's1', sessionsValidAfter: null, mfa_enabled: true };
    const plain = await refreshCall(auth.signProToken(PRO));
    expect([plain.statusCode, plain.body.code]).toEqual([401, 'MFA_SESSION_REQUIRED']);
    expect((await refreshCall(auth.signProToken(PRO, { mfa: true }))).statusCode).toBe(200);
  });
});

describe('R41-K F1: the 12 h maximum also holds at access time', () => {
  const T0 = Date.UTC(2026, 10, 3, 8, 0, 0);
  const H = 3600 * 1000;
  const refreshCall = async (token) => { const h = (await import('../../api/_handlers/pro/auth/refresh.js')).default; const r = mk(); await h({ method: 'POST', url: '/api/pro/auth/refresh', headers: { authorization: `Bearer ${token}` }, query: {}, body: {} }, r); return r; };
  const proCall = async (token) => {
    const auth = await import('../../api/_utils/auth.js');
    const ran = vi.fn(async (_req, res) => res.status(200).json({ ok: true }));
    const r = mk();
    await auth.requireProAuth(ran)({ method: 'GET', url: '/api/pro/cases', headers: { authorization: `Bearer ${token}` }, query: {} }, r);
    return { r, ran };
  };
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); state.membership = { role: 'PRO', status: 'active', structureId: 's1', sessionsValidAfter: null, mfa_enabled: false }; });
  afterEach(() => { vi.useRealTimers(); });

  it('a refresh at 11 h 59 gives a token that expires no later than sign-in + 12 h', async () => {
    const auth = await import('../../api/_utils/auth.js');
    const first = auth.signProToken(PRO);
    expect(jwt.decode(first).auth_time).toBe(T0 / 1000);
    vi.setSystemTime(T0 + 7 * H);
    const second = await refreshCall(first);
    expect(second.statusCode).toBe(200);
    vi.setSystemTime(T0 + 11 * H + 59 * 60 * 1000);
    const r = await refreshCall(second.body.token);
    expect(r.statusCode).toBe(200);
    const exp = jwt.decode(r.body.token).exp;
    expect(exp).toBeLessThanOrEqual(T0 / 1000 + auth.PRO_SESSION_MAX_AGE_SECONDS);
    vi.setSystemTime(T0 + 12 * H + 60 * 1000);
    const late = await proCall(r.body.token);
    expect(late.r.statusCode).toBe(401);
    expect(late.ran).not.toHaveBeenCalled();
  });
  it('a fresh session keeps its 8 h lifetime', async () => {
    const auth = await import('../../api/_utils/auth.js');
    const d = jwt.decode(auth.signProToken(PRO));
    expect(d.exp - d.iat).toBe(8 * 3600);
  });
  it('requireProAuth answers 401 SESSION_MAX_AGE at 12 h 01 to a still-unexpired token, and the handler does not run', async () => {
    const auth = await import('../../api/_utils/auth.js');
    // a token issued before R41 (8 h from a refresh at 11 h 59, not capped)
    vi.setSystemTime(T0 + 11 * H + 59 * 60 * 1000);
    const uncapped = jwt.sign({ userId: 'u1', email: PRO.email, structureId: 's1', role: 'PRO', scope: 'pro', jti: 'j1', auth_time: T0 / 1000 }, SECRET, { expiresIn: '8h', issuer: 'accesdirectaide', audience: 'accesdirectaide-pro', algorithm: 'HS256' });
    expect((await proCall(uncapped)).r.statusCode).toBe(200);
    vi.setSystemTime(T0 + 12 * H + 60 * 1000);
    expect(auth.verifyProToken(uncapped)).not.toBeNull();
    const { r, ran } = await proCall(uncapped);
    expect([r.statusCode, r.body.code]).toEqual([401, 'SESSION_MAX_AGE']);
    expect(ran).not.toHaveBeenCalled();
  });
});
