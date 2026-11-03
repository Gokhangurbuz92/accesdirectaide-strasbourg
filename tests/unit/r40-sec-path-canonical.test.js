/**
 * R40 security: the router resolves dot segments (literal or percent-encoded) with the WHATWG URL parser, so every path-based security decision must use the
 * same resolved path — or refuse a non-canonical one. Session helpers (pro/admin Bearer, citizen cookie) treat a request whose raw path is not canonical as
 * unauthenticated, so neither the second-factor rule nor the double-submit exemptions (api/_utils/csrf.js, pinned) can be sidestepped by an alias path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.resetModules(); vi.doUnmock('../../src/db/index.js'); });
const load = async (env = {}) => { vi.resetModules(); Object.assign(process.env, { JWT_SECRET: 'j'.repeat(40), ...env }); return import('../../api/_utils/auth.js'); };
const user = { id: 'u1', email: 'pro@example.test', structureId: 's1', role: 'PRO' };
const ALIASES = ['/api/pro/auth/%2e%2e/cases', '/api/pro/auth/%2E%2e/cases', '/api/pro/auth/.%2e/cases', '/api/pro/me/../cases', '/api/pro/auth\\..\\cases', '/api/pro/mfa-setup/%2e%2e/cases?x=1', '/api/pro/auth/./../cases'];

describe('canonical request paths', () => {
  it('isNonCanonicalPath flags dot segments in any encoding and backslashes, and accepts ordinary paths', async () => {
    const { isNonCanonicalPath } = await import('../../api/_utils/request-path.js');
    for (const u of ALIASES) expect(isNonCanonicalPath(u), u).toBe(true);
    for (const u of ['/api/pro/cases', '/api/pro/me?next=../x', '/api/aides/aide-au-logement', '/api/pro/cases/abc.def', '/api/files/a..b', '', undefined]) expect(isNonCanonicalPath(u), String(u)).toBe(false);
  });
  it('proRouteNeedsMfa decides on the resolved path and requires the second factor for any alias path', async () => {
    const { proRouteNeedsMfa } = await load();
    for (const u of ALIASES) expect(proRouteNeedsMfa(u), u).toBe(true);
    expect(proRouteNeedsMfa('/api/pro/auth/login')).toBe(false);
  });
  it('a pro session on an alias path is refused before any handler runs (production)', async () => {
    vi.doMock('../../src/db/index.js', () => ({ db: {} }));
    const auth = await load({ VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://u@db.example.test/x' });
    const token = auth.signProToken(user);
    let ran = false;
    const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await auth.requireProAuth(async (_q, r) => { ran = true; return r.status(200).json({}); })({ url: '/api/pro/auth/%2e%2e/cases', method: 'GET', headers: { authorization: `Bearer ${token}` } }, res);
    expect(ran).toBe(false);
    expect([401, 403]).toContain(res.code);
  });
  it('no session is resolved from a request whose path is not canonical (Bearer and citizen cookie)', async () => {
    vi.doMock('../../src/db/index.js', () => ({ db: {} }));
    const auth = await load();
    const token = auth.signProToken(user);
    expect(await auth.resolveAuthContext({ url: '/api/pro/cases', headers: { authorization: `Bearer ${token}` } })).not.toBeNull();
    for (const u of ALIASES) expect(await auth.resolveAuthContext({ url: u, headers: { authorization: `Bearer ${token}` } }), u).toBeNull();
    const { getUserSessionTokenFromRequest } = await import('../../api/_utils/user-auth.js');
    expect(getUserSessionTokenFromRequest({ url: '/api/citizen/profile', headers: { cookie: 'ada_user_session=abc' } })).toBe('abc');
    for (const u of ['/api/contact/%2e%2e/citizen/profile', '/api/health/../citizen/profile']) expect(getUserSessionTokenFromRequest({ url: u, headers: { cookie: 'ada_user_session=abc' } }), u).toBeNull();
  });
});
