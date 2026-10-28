/**
 * Outlook availability: stored-token contract (ProOutlookToken.accessTokenEnc / refreshTokenEnc, AES-256-GCM envelope `iv:tag:data`).
 * Regression for: handler read non-existent columns (accessToken/refreshToken) and wrote `encryptToken(...).content` (undefined) after a refresh,
 * plus plaintext fallbacks when the key was missing. MOCK-LEVEL: db and Microsoft endpoints are fakes (no network, no real tokens); the crypto is real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('AUTH_SECRET', 'test-auth-secret-outlook');
vi.stubEnv('OUTLOOK_TOKEN_ENCRYPTION_KEY', 'k'.repeat(40));
vi.stubEnv('OUTLOOK_CLIENT_ID', 'client-id-test'); vi.stubEnv('OUTLOOK_CLIENT_SECRET', 'client-secret-test');

const state = { row: null, updates: [] };
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: { ProOutlookToken: { findFirst: vi.fn(async () => state.row) } },
    update: vi.fn(() => ({ set: (v) => ({ where: async () => { state.updates.push(v); } }) })),
  },
}));

import handler from '../../api/_handlers/pro/outlook-availability.js';
import { signProToken } from '../../api/_utils/auth.js';
import { decryptToken, encryptToken, envelopeIv } from '../../api/_utils/outlook-token-crypto.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const token = `Bearer ${signProToken({ id: 'pro-1', email: 'pro1@example.test', structureId: 'S-1', role: 'STRUCTURE_ADMIN' })}`;
const call = async () => { const r = mk(); await handler({ method: 'GET', url: '/api/pro/outlook-availability?start=2026-11-01T08:00:00&end=2026-11-01T12:00:00', query: {}, headers: { host: 'x', authorization: token } }, r); return r; };
const row = (over = {}) => ({ userId: 'pro-1', accessTokenEnc: encryptToken('ACCESS-1'), refreshTokenEnc: encryptToken('REFRESH-1'), iv: 'x', expiresAt: new Date(Date.now() + 3600_000), ...over });
const graphOk = (view = '0012') => ({ ok: true, status: 200, json: async () => ({ value: [{ availabilityView: view }] }) });

describe('outlook token envelope (strict)', () => {
  it('round-trips; rejects malformed/plaintext input instead of passing it through; iv helper', () => {
    const e = encryptToken('secret-token'); expect(e.split(':')).toHaveLength(3); expect(e).not.toContain('secret-token');
    expect(decryptToken(e)).toBe('secret-token'); expect(envelopeIv(e)).toBe(e.split(':')[0]);
    for (const bad of ['plain-token', 'a:b', '', undefined, null, 'zz:zz:zz']) expect(() => decryptToken(bad)).toThrow();
    const tampered = e.slice(0, -2) + (e.endsWith('00') ? '11' : '00'); expect(() => decryptToken(tampered)).toThrow();
  });
});

describe('GET /api/pro/outlook-availability (MOCK db + fake Microsoft)', () => {
  beforeEach(() => { state.row = row(); state.updates.length = 0; vi.unstubAllGlobals(); });

  it('decrypts the stored access token and queries Graph with it (Bearer), returns availability slots', async () => {
    const f = vi.fn().mockResolvedValue(graphOk('0012')); vi.stubGlobal('fetch', f);
    const r = await call();
    expect(r.statusCode).toBe(200); expect(r.body.slots.map((s) => s.status)).toEqual(['libre', 'libre', 'provisoire', 'occupé']);
    expect(f.mock.calls[0][0]).toContain('graph.microsoft.com'); expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer ACCESS-1');
  });

  it('no stored token → 404; corrupted/plaintext token → 401 (never forwarded to Graph)', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    state.row = null; expect((await call()).statusCode).toBe(404);
    state.row = row({ accessTokenEnc: 'PLAINTEXT-ACCESS-TOKEN' }); expect((await call()).statusCode).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('expired token → refresh → new tokens are PERSISTED encrypted (all columns defined), then Graph is called with the new token', async () => {
    state.row = row({ expiresAt: new Date(Date.now() - 1000) });
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'ACCESS-2', refresh_token: 'REFRESH-2', expires_in: 3600 }) })
      .mockResolvedValueOnce(graphOk('00'));
    vi.stubGlobal('fetch', f);
    const r = await call(); expect(r.statusCode).toBe(200);
    expect(f.mock.calls[0][0]).toContain('login.microsoftonline.com');
    expect(String(f.mock.calls[0][1].body)).toContain('refresh_token=REFRESH-1');                       // decrypted refresh token was used
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer ACCESS-2');
    const u = state.updates[0]; expect(Object.values(u).every((v) => v !== undefined)).toBe(true);
    expect(decryptToken(u.accessTokenEnc)).toBe('ACCESS-2'); expect(decryptToken(u.refreshTokenEnc)).toBe('REFRESH-2'); expect(u.iv).toBe(envelopeIv(u.accessTokenEnc));
    expect(u.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refresh keeps the old refresh token when Microsoft does not rotate it; failed refresh → 401 and nothing persisted', async () => {
    state.row = row({ expiresAt: new Date(Date.now() - 1000) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'ACCESS-3', expires_in: 60 }) }).mockResolvedValueOnce(graphOk('0')));
    expect((await call()).statusCode).toBe(200); expect(decryptToken(state.updates[0].refreshTokenEnc)).toBe('REFRESH-1');
    state.updates.length = 0; state.row = row({ expiresAt: new Date(Date.now() - 1000) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 400, json: async () => ({ error: 'invalid_grant' }) }));
    expect((await call()).statusCode).toBe(401); expect(state.updates).toHaveLength(0);
  });

  it('Graph 401 at runtime → one refresh + one retry; second failure → 502', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'ACCESS-4', refresh_token: 'REFRESH-4', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', f);
    expect((await call()).statusCode).toBe(502); expect(f).toHaveBeenCalledTimes(3);
  });
});
