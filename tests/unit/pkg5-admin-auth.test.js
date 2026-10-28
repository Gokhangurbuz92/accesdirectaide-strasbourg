/**
 * PKG-5 / A01 A16 — the retired shared ADMIN_TOKEN is refused in production (and outside the frozen test suites unless explicitly opted in outside production);
 * a professional token claiming SUPERADMIN is never an administrator; an administrator session needs MFA for any state-changing request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.resetModules(); });
const req = (token, method = 'GET') => ({ method, headers: { authorization: `Bearer ${token}` } });

describe('PKG-5 admin authentication', () => {
  it('legacy ADMIN_TOKEN: refused in production even when set; accepted only under NODE_ENV=test or an explicit non-production opt-in', async () => {
    process.env.ADMIN_TOKEN = 'legacy-admin-token-value-for-tests-0001';
    const auth = await import('../../api/_utils/auth.js');   // module loaded once; the rule reads the environment at call time
    process.env.NODE_ENV = 'test'; process.env.VERCEL_ENV = 'test';
    expect(auth.legacyAdminTokenAllowed(), 'frozen RC4 suites').toBe(true);
    process.env.NODE_ENV = 'production';
    expect(auth.legacyAdminTokenAllowed()).toBe(false); expect(await auth.verifyAdmin(req(process.env.ADMIN_TOKEN))).toBe(false);
    process.env.NODE_ENV = 'development'; delete process.env.ADA_ALLOW_LEGACY_ADMIN_TOKEN;
    expect(auth.legacyAdminTokenAllowed(), 'off by default outside tests').toBe(false);
    process.env.ADA_ALLOW_LEGACY_ADMIN_TOKEN = '1'; expect(auth.legacyAdminTokenAllowed()).toBe(true);
    // R12 (A01): under the non-production opt-in the token may read, never write
    expect(await auth.verifyAdmin(req(process.env.ADMIN_TOKEN))).toBe(true);
    expect(await auth.verifyAdmin(req(process.env.ADMIN_TOKEN, 'POST'))).toBe(false);
    process.env.VERCEL_ENV = 'production';
    expect(auth.legacyAdminTokenAllowed(), 'never on a production deployment').toBe(false);
  });

  it('a professional token claiming SUPERADMIN is not an administrator; an admin session without MFA may read but not write', async () => {
    process.env.NODE_ENV = 'test';
    const auth = await import('../../api/_utils/auth.js');
    const proSuper = auth.signProToken({ id: 'u1', email: 'p@example.test', structureId: 's1', role: 'SUPERADMIN' });
    expect(await auth.verifyAdmin(req(proSuper))).toBe(false);
    const noMfa = auth.signAdminSessionToken({ email: 'a@example.test', role: 'admin', mfa_verified: false });
    const mfa = auth.signAdminSessionToken({ email: 'a@example.test', role: 'admin', mfa_verified: true });
    expect(await auth.verifyAdmin(req(noMfa, 'GET'))).toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) { expect(await auth.verifyAdmin(req(noMfa, m)), m).toBe(false); expect(await auth.verifyAdmin(req(mfa, m)), m).toBe(true); }
  });
});
