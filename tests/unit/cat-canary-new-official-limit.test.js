/**
 * CAT-CANARY (13/11/2026): ADA_VEILLE_NEW_OFFICIAL_LIMIT lets the owner publish a small first batch of Level 1 official fiches before the normal 150 a night.
 *  - an integer 1..150 → limits.newOfficial = n; "0" → 0 (no new fiche, even with ADA_VEILLE_NEW_OFFICIAL=on);
 *  - unset / empty → nothing passed (the chain's default, 150); invalid, negative or above 150 → nothing passed + a warning. It never raises the limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: (req) => (req.headers?.authorization === 'Bearer ok' ? { ok: true } : { ok: false, reason: 'unauthorized' }) }));
vi.mock('../../api/lib/search-cache.js', () => ({ bumpContentEpoch: async () => {} }));
vi.mock('../../api/_services/verification/chain.js', () => ({ runVeille: vi.fn() }));

const { default: handler, newOfficialLimit, NEW_OFFICIAL_MAX } = await import('../../api/_handlers/cron/veille.js');
const { logger } = await import('../../api/lib/logger.js');
const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

const KEY = 'ADA_VEILLE_NEW_OFFICIAL_LIMIT';
let prev; let warn;
beforeEach(() => { prev = process.env[KEY]; delete process.env[KEY]; warn = vi.spyOn(logger, 'warn').mockImplementation(() => {}); });
afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; warn.mockRestore(); });

async function passed(value) {
  if (value === undefined) delete process.env[KEY]; else process.env[KEY] = value;
  const run = vi.fn(async () => ({ ok: true, status: 'success', counts: {} })); const r = res();
  await handler({ headers: { authorization: 'Bearer ok' }, query: { slot: '0' } }, r, { runVeille: run });
  expect(r.code).toBe(200);
  expect(run).toHaveBeenCalledTimes(1);
  return run.mock.calls[0][0];
}

describe('ADA_VEILLE_NEW_OFFICIAL_LIMIT on the cron route (slot 0, the fiches step)', () => {
  it('unset: no limits passed (the chain keeps 150), no warning', async () => {
    const o = await passed(undefined);
    expect(o).not.toHaveProperty('limits'); expect(warn).not.toHaveBeenCalled();
    expect(o).toMatchObject({ only: ['aide', 'demarche', 'dispositif', 'fiches'], nightCap: true, trigger: 'cron:slot0' });
  });
  it('empty: same as unset, no warning', async () => {
    const o = await passed('');
    expect(o).not.toHaveProperty('limits'); expect(warn).not.toHaveBeenCalled();
  });
  it('"20": limits = { newOfficial: 20 } and nothing else', async () => {
    const o = await passed('20');
    expect(o.limits).toEqual({ newOfficial: 20 }); expect(warn).not.toHaveBeenCalled();
  });
  it('"0": limits = { newOfficial: 0 } (no new fiche even with the flag on)', async () => {
    const o = await passed('0');
    expect(o.limits).toEqual({ newOfficial: 0 }); expect(warn).not.toHaveBeenCalled();
  });
  it('"150": the maximum is accepted', async () => {
    expect((await passed('150')).limits).toEqual({ newOfficial: 150 });
  });
  for (const bad of ['151', 'abc', '-1']) {
    it(`"${bad}": default kept (no limits passed) and a warning is logged`, async () => {
      const o = await passed(bad);
      expect(o).not.toHaveProperty('limits');
      expect(warn).toHaveBeenCalledWith('VEILLE_NEW_OFFICIAL_LIMIT_INVALID', expect.objectContaining({ value: bad, kept: 150 }));
    });
  }
});

describe('newOfficialLimit never raises the limit', () => {
  it('only base-10 integers 0..150', () => {
    expect(NEW_OFFICIAL_MAX).toBe(150);
    for (const [v, n] of [['1', 1], ['20', 20], [' 7 ', 7], ['0', 0], ['150', 150]]) expect(newOfficialLimit(v), v).toBe(n);
    for (const v of [undefined, '', '  ', '151', '1000', '-1', '1.5', '1e2', '0x10', '+5', 'abc', 'Infinity']) expect(newOfficialLimit(v), String(v)).toBeNull();
  });
});
