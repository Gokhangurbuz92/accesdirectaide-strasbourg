/**
 * R47 audit — provider calls without a time bound (backlog sweep): the Outlook free/busy route (three Microsoft calls) and the AGEFIPH page fetch of the
 * scheduled ingest-aids job passed no signal, so a provider that never answers held the function until the platform killed it. MOCK-LEVEL: fetch and the
 * database are fakes (no network); the crypto is real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('AUTH_SECRET', 'test-auth-secret-r47-timeouts');
vi.stubEnv('OUTLOOK_TOKEN_ENCRYPTION_KEY', 'k'.repeat(40));
vi.stubEnv('OUTLOOK_CLIENT_ID', 'client-id-test'); vi.stubEnv('OUTLOOK_CLIENT_SECRET', 'client-secret-test');
vi.stubEnv('OUTLOOK_ENABLED', 'true'); vi.stubEnv('OUTLOOK_REDIRECT_URI', 'https://lab.invalid/api/auth/callback/outlook');

const state = { row: null };
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: { ProOutlookToken: { findFirst: vi.fn(async () => state.row) } },
    update: vi.fn(() => ({ set: () => ({ where: async () => {} }) })),
  },
}));

import handler, { OUTLOOK_PROVIDER_TIMEOUT_MS } from '../../api/_handlers/pro/outlook-availability.js';
import { signProToken } from '../../api/_utils/auth.js';
import { encryptToken } from '../../api/_utils/outlook-token-crypto.js';
import { AgefiphConnector, AGEFIPH_TIMEOUT_MS } from '../../api/lib/ingestion/AgefiphConnector.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const token = `Bearer ${signProToken({ id: 'pro-1', email: 'pro1@example.test', structureId: 'S-1', role: 'STRUCTURE_ADMIN' })}`;
const call = async () => { const r = mk(); await handler({ method: 'GET', url: '/api/pro/outlook-availability?start=2026-11-01T08:00:00&end=2026-11-01T12:00:00', query: {}, headers: { host: 'x', authorization: token } }, r); return r; };
const row = (over = {}) => ({ userId: 'pro-1', accessTokenEnc: encryptToken('ACCESS-1'), refreshTokenEnc: encryptToken('REFRESH-1'), iv: 'x', expiresAt: new Date(Date.now() + 3600_000), ...over });
const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

describe('R47: Outlook free/busy calls are bounded', () => {
  beforeEach(() => { state.row = row(); vi.unstubAllGlobals(); });

  it('every Microsoft call (token refresh, Graph read, Graph retry) carries an AbortSignal', async () => {
    expect(OUTLOOK_PROVIDER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(OUTLOOK_PROVIDER_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    state.row = row({ expiresAt: new Date(Date.now() - 1000) });
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'ACCESS-2', refresh_token: 'REFRESH-2', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'ACCESS-3', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [{ availabilityView: '00' }] }) });
    vi.stubGlobal('fetch', f);
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(f).toHaveBeenCalledTimes(4);
    for (const [, init] of f.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('Graph not answering in time → 504 with the plain provider message (not a 500 server fault)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError()));
    const r = await call();
    expect(r.statusCode).toBe(504);
    expect(r.body).toEqual({ error: 'Impossible de lire l\'agenda Outlook.' });
  });

  it('a network failure (fetch failed) is the provider\'s state too; any other fault stays a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect((await call()).statusCode).toBe(504);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x is not a function')));
    expect((await call()).statusCode).toBe(500);
  });
});

describe('R47: the AGEFIPH page fetch of ingest-aids is bounded', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('passes an AbortSignal and fails (never hangs) when the page does not answer', async () => {
    expect(AGEFIPH_TIMEOUT_MS).toBe(15_000);
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<html></html>' });
    vi.stubGlobal('fetch', ok);
    await new AgefiphConnector().fetch('https://www.agefiph.fr/aides-financieres');
    expect(ok.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    vi.stubGlobal('fetch', vi.fn((_u, init) => new Promise((_r, reject) => { init.signal.addEventListener('abort', () => reject(timeoutError())); })));
    // the connector's own bound, observed through the signal it hands to fetch: aborting that signal ends the request with an error
    const ctl = new AbortController();
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(ctl.signal);
    try {
      const p = new AgefiphConnector().fetch('https://www.agefiph.fr/x');
      ctl.abort();
      await expect(p).rejects.toThrow(/timeout/);
      expect(spy).toHaveBeenCalledWith(AGEFIPH_TIMEOUT_MS);
    } finally { spy.mockRestore(); }
  });
});
