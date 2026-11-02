/**
 * R34 (R33 audit G4): in production every ADA Pro route needs a session that passed the second factor (deny by default); signing in, the account
 * summary and MFA setup stay open. The claim is set only by the second factor and kept — never added — by a refresh; MFA cannot be switched off where
 * it is required. Outside production nothing changes unless PRO_MFA_REQUIRED=true.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.resetModules(); });
const load = async (env = {}) => { vi.resetModules(); Object.assign(process.env, { JWT_SECRET: 'j'.repeat(40), ...env }); return import('../../api/_utils/auth.js'); };
const user = { id: 'u1', email: 'pro@example.test', structureId: 's1', role: 'PRO' };

describe('ADA Pro second factor', () => {
  it('the token carries mfa only when the second factor was passed, and verification reads it', async () => {
    const auth = await load();
    expect(auth.verifyProToken(auth.signProToken(user)).mfa).toBe(false);
    expect(auth.verifyProToken(auth.signProToken(user, { mfa: true })).mfa).toBe(true);
    const forged = jwt.sign({ userId: 'u1', structureId: 's1', role: 'PRO', scope: 'pro', mfa: true }, 'another-secret');
    expect(auth.verifyProToken(forged)).toBeNull();
  });
  it('required in production, opt-in elsewhere, with no off switch in production', async () => {
    expect((await load({ VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://u@db.example.test/x' })).proMfaRequired()).toBe(true);
    expect((await load({ VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://u@db.example.test/x', PRO_MFA_REQUIRED: 'false' })).proMfaRequired()).toBe(true);
    expect((await load({ VERCEL_ENV: 'preview' })).proMfaRequired()).toBe(false);
    expect((await load({ VERCEL_ENV: 'preview', PRO_MFA_REQUIRED: 'true' })).proMfaRequired()).toBe(true);
  });
  it('deny by default: only sign-in, the account summary and MFA setup are open to a password-only session', async () => {
    const { proRouteNeedsMfa } = await load();
    for (const u of ['/api/pro/auth/login', '/api/pro/auth/mfa-verify', '/api/pro/auth/refresh', '/api/pro/mfa-setup', '/api/pro/me', '/api/pro/me?x=1']) expect(proRouteNeedsMfa(u), u).toBe(false);
    for (const u of ['/api/pro/cases', '/api/pro/dossier/upload-secure', '/api/pro/messages', '/api/pro/referrals', '/api/pro/dossier-synthesis', '/api/pro/mfa-setup/../cases', '/api/pro/meeting', '', undefined]) expect(proRouteNeedsMfa(u), String(u)).toBe(true);
  });
  it('behaviour: in production a password-only session is refused on a dossier route (403 PRO_MFA_REQUIRED) and passes on /api/pro/me; with the second factor it passes', async () => {
    vi.doMock('../../src/db/index.js', () => ({ db: {} }));   // no membership lookup in this unit (the token's claims stand)
    const auth = await load({ VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://u@db.example.test/x' });
    const call = async (url, token) => {
      const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await auth.requireProAuth(async (_req, r) => r.status(200).json({ ok: true }))({ url, method: 'GET', headers: { authorization: `Bearer ${token}` } }, res);
      return res;
    };
    const plain = auth.signProToken(user); const strong = auth.signProToken(user, { mfa: true });
    expect(await call('/api/pro/cases', plain)).toMatchObject({ code: 403, body: { code: 'PRO_MFA_REQUIRED' } });
    expect((await call('/api/pro/me', plain)).code).toBe(200);
    expect((await call('/api/pro/cases', strong)).code).toBe(200);
    vi.doUnmock('../../src/db/index.js');
  });
  it('the refusal is wired in requireProAuth, refresh keeps the claim, mfa-verify and mfa-setup set it, and disabling is refused where required', () => {
    const a = fs.readFileSync('api/_utils/auth.js', 'utf8');
    expect(a).toMatch(/proMfaRequired\(\) && \/\*\* @type \{any\} \*\/ \(auth\)\.mfa !== true && proRouteNeedsMfa\(req\.url\)/);
    const r = fs.readFileSync('api/_handlers/pro/auth/refresh.js', 'utf8');
    expect(r.match(/\{ mfa: (validClaims|decoded)\.mfa === true \}/g)).toHaveLength(2);
    expect(fs.readFileSync('api/_handlers/pro/auth/mfa-verify.js', 'utf8')).toMatch(/signProToken\(user, \{ mfa: true \}\)/);
    const setup = fs.readFileSync('api/_handlers/pro/mfa-setup.js', 'utf8');
    expect(setup).toMatch(/if \(proMfaRequired\(\)\) return res\.status\(403\)/);
    expect(setup).toMatch(/\{ mfa: true \}\) \}\);/);
    expect(fs.readFileSync('src/pages/pro/ProLayout.jsx', 'utf8')).toMatch(/data\.session\?\.mfaRequired && !data\.session\.mfa/);
  });
});
