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
