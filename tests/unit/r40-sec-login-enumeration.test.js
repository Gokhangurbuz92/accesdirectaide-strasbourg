/**
 * R40 security — sign-in answers do not tell which accounts exist: the administrator login does the same password work for an unknown, disabled or locked
 * account and answers a locked account like a wrong password (the lock is in the audit trail); the professional « forgotten password » sends its links
 * after the answer, so its response time does not depend on the account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const saved = { ...process.env };
const state = { admin: null, audits: [], checks: [] };
beforeEach(() => {
  vi.resetModules();
  Object.assign(state, { admin: null, audits: [], checks: [] });
  vi.doMock('../../api/_utils/user-auth.js', () => ({ verifyPassword: async (p, h) => { state.checks.push(h); return false; } }));
});
afterEach(() => { process.env = { ...saved }; vi.resetModules(); vi.doUnmock('../../api/_utils/user-auth.js'); });

const db = () => ({
  select: () => { const c = { from: () => c, where: () => c, limit: async () => (state.admin ? [state.admin] : []) }; return c; },
  insert: () => ({ values: (v) => { state.audits.push(v.action); return Promise.resolve(); } }),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ n: 1 }] }) }) }),
});

describe('administrator sign-in', () => {
  it('an unknown e-mail costs one password check and answers 401', async () => {
    const { adminLogin } = await import('../../api/_services/admin-identity.js');
    const r = await adminLogin({ email: 'nobody@example.test', password: 'x' }, { db: db() });
    expect([r.status, r.code]).toEqual([401, 'invalid_credentials']);
    expect(state.checks).toHaveLength(1);
  });
  it('a locked or disabled account answers exactly like a wrong password, after the same work; the lock is audited', async () => {
    const { adminLogin } = await import('../../api/_services/admin-identity.js');
    state.admin = { id: 'a1', email: 'adm@example.test', password: 'scrypt:x', lockoutUntil: new Date(Date.now() + 600000) };
    const locked = await adminLogin({ email: 'adm@example.test', password: 'x' }, { db: db() });
    state.admin = { id: 'a1', email: 'adm@example.test', password: 'scrypt:x', lockoutUntil: null };
    const wrong = await adminLogin({ email: 'adm@example.test', password: 'x' }, { db: db() });
    state.admin = { id: 'a1', email: 'adm@example.test', password: 'scrypt:x', disabledAt: new Date() };
    const disabled = await adminLogin({ email: 'adm@example.test', password: 'x' }, { db: db() });
    expect(locked).toEqual(wrong);
    expect(disabled).toEqual(wrong);
    expect(state.checks).toHaveLength(3);
    expect(state.audits).toEqual(expect.arrayContaining(['ADMIN_LOGIN_LOCKED', 'ADMIN_LOGIN_DISABLED', 'ADMIN_LOGIN_FAILED']));
  });
});

describe('professional forgotten password', () => {
  it('the links are sent after the answer (waitUntil), not inline', () => {
    const src = fs.readFileSync('api/_handlers/pro/auth/forgot-password.js', 'utf8');
    expect(src).toMatch(/waitUntil\(sendResetLinks\(users, ip\)/);
    const handler = src.slice(src.indexOf('export default async function handler'));
    expect(handler).not.toMatch(/await sendMail|await kv\.set/);
  });
});
