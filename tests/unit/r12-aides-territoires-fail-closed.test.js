/**
 * R12 (D08) — the Aides-Territoires connector fails closed: an answer without a token field gives no token (no guessing), and a refused connection never
 * echoes the answer body in its error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../api/lib/logger.js', () => { const m = () => {}; return { logger: { info: m, warn: m, error: m, debug: m } }; });
import { AidesTerritoiresConnector } from '../../api/lib/ingestion/AidesTerritoiresConnector.js';

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); });

describe('Aides-Territoires authentication', () => {
  it('an answer that is a bare string is not used as a bearer token', async () => {
    process.env.AIDES_TERRITOIRES_API_KEY = 'synthetic-key';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => 'x'.repeat(64) })));
    expect(await new AidesTerritoiresConnector()._authenticate()).toBeNull();
  });
  it('a refused connection: the error carries the status only', async () => {
    process.env.AIDES_TERRITOIRES_API_KEY = 'synthetic-key';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'echo synthetic-key' })));
    await expect(new AidesTerritoiresConnector()._authenticate()).rejects.toThrow(/^Connexion API 401$/);
  });
});

describe('R38 — without a credential, nothing is fetched', () => {
  it('no AIDES_TERRITOIRES_API_KEY → AT_CREDENTIALS_MISSING before any call', async () => {
    delete process.env.AIDES_TERRITOIRES_API_KEY;
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(new AidesTerritoiresConnector().getDetailUrls()).rejects.toMatchObject({ code: 'AT_CREDENTIALS_MISSING' });
    expect(f).not.toHaveBeenCalled();
  });
  it('a connexion answer without a token → AT_BEARER_MISSING, and /api/aids/ is never called', async () => {
    process.env.AIDES_TERRITOIRES_API_KEY = 'synthetic-key';
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: true }) })); vi.stubGlobal('fetch', f);
    await expect(new AidesTerritoiresConnector().getDetailUrls()).rejects.toMatchObject({ code: 'AT_BEARER_MISSING' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toMatch(/\/api\/connexion\/$/);
  });
  it('the two-step contract: X-AUTH-TOKEN on connexion, then the Bearer on /api/aids/', async () => {
    process.env.AIDES_TERRITOIRES_API_KEY = 'synthetic-key';
    const f = vi.fn(async (u) => (String(u).includes('/connexion/') ? { ok: true, json: async () => ({ token: 'b'.repeat(40) }) }
      : { ok: true, json: async () => ({ count: 0, next: null, results: [] }) }));
    vi.stubGlobal('fetch', f);
    await new AidesTerritoiresConnector().getDetailUrls().catch(() => {});
    expect(f.mock.calls[0][1].headers['X-AUTH-TOKEN']).toBe('synthetic-key');
    expect(f.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${'b'.repeat(40)}`);
  });
});
