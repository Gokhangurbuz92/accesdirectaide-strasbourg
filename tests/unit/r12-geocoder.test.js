/**
 * R12 (N11) — the geocoder is bounded (an abort signal on every request) and never writes the address it looked up into the logs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const L = vi.hoisted(() => ({ lines: [] }));
vi.mock('../../api/_utils/logger.js', () => { const m = (...a) => { L.lines.push(JSON.stringify(a)); }; return { default: { info: m, warn: m, error: m, debug: m } }; });
import { geocodeAddress } from '../../api/_utils/geocoder.js';

afterEach(() => { vi.unstubAllGlobals(); L.lines = []; });
const ADDRESS = '12 rue Synthétique-Témoin, 67000 Strasbourg';

describe('geocoder', () => {
  it('sends an abort signal and returns the coordinates', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ features: [{ geometry: { coordinates: [7.75, 48.58] }, properties: { score: 0.9 } }] }) }));
    vi.stubGlobal('fetch', f);
    expect(await geocodeAddress(ADDRESS)).toEqual({ lat: 48.58, lng: 7.75, score: 0.9 });
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('a failure returns null and the log has no address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }));
    expect(await geocodeAddress(ADDRESS)).toBeNull();
    expect(L.lines.join('\n')).not.toContain('Synthétique');
    expect(L.lines.join('\n')).toContain('TimeoutError');
  });
});
