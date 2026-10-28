/**
 * R12 (C01) — a citizen logout whose server-side revocation fails is reported (503 LOGOUT_NOT_CONFIRMED), never as a completed logout; the browser cookie is
 * cleared in both cases.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ fail: false }));
vi.mock('../../src/db/index.js', () => ({ db: { update: () => ({ set: () => ({ where: async () => { if (S.fail) throw new Error('db down'); return []; } }) }) } }));
vi.mock('../../api/_utils/user-auth.js', () => ({ buildUserSessionCookieClear: () => 'ada_session=; Max-Age=0', getUserSessionTokenFromRequest: () => 't', verifyUserSessionToken: () => ({ userId: 'u1' }) }));
import handler from '../../api/_handlers/auth/logout.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
beforeEach(() => { S.fail = false; });

describe('citizen logout', () => {
  it('revoked: 200', async () => { const r = mk(); await handler({ method: 'POST', headers: {} }, r); expect(r.statusCode).toBe(200); expect(r.headers['Set-Cookie']).toMatch(/Max-Age=0/); });
  it('revocation failed: 503 LOGOUT_NOT_CONFIRMED, cookie still cleared', async () => {
    S.fail = true; const r = mk(); await handler({ method: 'POST', headers: {} }, r);
    expect(r.statusCode).toBe(503); expect(r.body.error).toBe('LOGOUT_NOT_CONFIRMED'); expect(r.headers['Set-Cookie']).toMatch(/Max-Age=0/);
  });
});
