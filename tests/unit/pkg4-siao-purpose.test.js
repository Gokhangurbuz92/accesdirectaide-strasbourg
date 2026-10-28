/**
 * PKG-4 / D10 — SI-SIAO transmission: even with the feature flag ON and a provider URL configured, nothing is sent unless the citizen granted the dedicated SIAO purpose
 * (sharing PURP-06 or the AI purpose PURP-05 never stand in for it); when it is sent, the identifier is a keyed pseudonym (not the dossier id) and no log line carries the
 * dossier id or the provider's answer body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ found: null, logs: [], inserted: [] }));
vi.mock('../../api/_utils/env.js', () => ({ env: { siao: { enabled: true, apiUrl: 'https://siao.lab.invalid', apiKey: 'lab-key' }, secrets: { jwtSecret: 'x' } } }));
vi.mock('../../api/_utils/auth.js', () => ({ requireProAuth: (fn) => fn, requireProStructureContext: () => ({ userId: 'u1', structureId: 's1', role: 'PRO' }) }));
vi.mock('../../api/_utils/share-access.js', async (orig) => ({ ...(await orig()), resolveDossierForStructure: vi.fn(async () => h.found) }));
vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: async (v) => { h.inserted.push(v); } }) } }));
vi.mock('../../api/_utils/logger.js', () => ({ default: { info: (...a) => h.logs.push(a), warn: (...a) => h.logs.push(a), error: (...a) => h.logs.push(a) } }));

const SHARE = 'dossier-0123456789abcdef';
const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });
const call = async (handler) => { const r = mk(); await handler({ method: 'POST', body: { shareId: SHARE }, headers: {} }, r); return r; };
const dossier = { id: SHARE, situation: { zipCode: '67000', isUrgent: true }, createdAt: new Date('2026-10-01T00:00:00Z') };

describe('PKG-4 D10 SI-SIAO purpose', () => {
  let handler, fetchSpy;
  beforeEach(async () => {
    h.logs.length = 0; h.inserted.length = 0;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"echo":"' + SHARE + '"}', { status: 500 }));
    handler = (await import('../../api/_handlers/pro/interop-siao.js')).default;
  });

  it.each([['sharing only', 'PURP-06'], ['sharing + AI', 'PURP-06,PURP-05'], ['nothing', ''], ['look-alike', 'PURP-070']])('refuses without the SIAO purpose (%s): 403, no network call, no audit row', async (_, purposes) => {
    h.found = { status: 'ok', shared: dossier, grant: { purposes } };
    const r = await call(handler);
    expect(r.statusCode).toBe(403); expect(r.body.status).toBe('purpose_required');
    expect(fetchSpy).not.toHaveBeenCalled(); expect(h.inserted).toEqual([]);
  });

  it('with the SIAO purpose: a keyed pseudonym is sent, never the dossier id; logs carry neither the id nor the provider answer; the audit records the purpose', async () => {
    h.found = { status: 'ok', shared: dossier, grant: { purposes: 'PURP-06,PURP-07' } };
    const r = await call(handler);
    expect(r.statusCode).toBe(502); expect(r.body.transmissionStatus).toBe('FAILED'); expect(r.body.ok, 'R12: a refused transmission is not a success').toBe(false);
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sent.demandeur.identifiant_anonyme).toMatch(/^[0-9a-f]{24}$/); expect(JSON.stringify(sent)).not.toContain(SHARE.slice(0, 10));
    expect(JSON.stringify(h.logs)).not.toContain(SHARE.slice(0, 10));
    expect(h.inserted[0].details.purpose).toBe('PURP-07');
  });
});
