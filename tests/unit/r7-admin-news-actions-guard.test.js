/**
 * R7 admin — the news inbox PUBLISH / REJECT apply only from the statuses the moderation flow allows:
 *  - PUBLISH: an imported draft ('brouillon') only — never a rejected item, never a retracted ADA article, never an ADA original (editorial workflow);
 *  - REJECT: an imported draft, or a published imported item (take-down) — never an item already rejected or retracted, never an ADA original.
 * Anything else answers 409 and nothing is written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { rows: [], updates: 0, audits: 0 };
const chain = (result) => { const c = { from: () => c, where: () => c, limit: () => c, set: () => c, values: () => { state.audits += 1; return Promise.resolve(); }, returning: () => { state.updates += 1; return Promise.resolve(result()); }, then: (ok, ko) => Promise.resolve(result()).then(ok, ko) }; return c; };

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: () => chain(() => state.rows),
    update: () => chain(() => state.rows.map((r) => ({ id: r.id }))),
    insert: () => chain(() => []),
  },
}));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/auth.js', () => ({ verifyAdmin: vi.fn().mockResolvedValue(true), getAuthenticatedUser: vi.fn().mockResolvedValue({ email: 'admin@example.test' }) }));

const resOf = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const act = async (action, ids) => {
  const handler = (await import('../../api/_handlers/admin/actions.js')).default;
  const res = resOf();
  await handler({ method: 'POST', headers: {}, query: {}, body: { action, ids, reason: 'Motif de décision suffisant.' } }, res);
  return res;
};

describe('R7 admin — news PUBLISH / REJECT status guard', () => {
  beforeEach(() => { state.rows = []; state.updates = 0; state.audits = 0; });

  it('publishes an imported draft', async () => {
    state.rows = [{ id: 'a', statut: 'brouillon', type_actu: null }];
    const r = await act('PUBLISH', ['a']);
    expect([r.statusCode, r.body.count, state.updates]).toEqual([200, 1, 1]);
  });

  it.each([['rejected', null], ['retire', 'ada_original'], ['brouillon', 'ada_original'], ['a_relire', 'ada_original'], ['publie', null]])('refuses to publish an item in %s (%s) with 409 and writes nothing', async (statut, type) => {
    state.rows = [{ id: 'b', statut, type_actu: type }];
    const r = await act('PUBLISH', ['b']);
    expect([r.statusCode, r.body.error, state.updates]).toEqual([409, 'INVALID_STATE', 0]);
    expect(r.body.ids).toEqual(['b']);
  });

  it('rejects a draft and takes down a published imported item', async () => {
    state.rows = [{ id: 'c', statut: 'brouillon', type_actu: null }, { id: 'd', statut: 'publie', type_actu: 'rss' }];
    const r = await act('REJECT', ['c', 'd']);
    expect([r.statusCode, r.body.count]).toEqual([200, 2]);
  });

  it.each([['rejected', null], ['retire', 'ada_original'], ['a_relire', 'ada_original']])('refuses to reject an item in %s (%s) with 409', async (statut, type) => {
    state.rows = [{ id: 'e', statut, type_actu: type }, { id: 'f', statut: 'brouillon', type_actu: null }];
    const r = await act('REJECT', ['e', 'f']);
    expect([r.statusCode, r.body.error, state.updates]).toEqual([409, 'INVALID_STATE', 0]);
    expect(r.body.ids).toEqual(['e']);
  });

  it('RETRY_FALC keeps working whatever the status', async () => {
    state.rows = [{ id: 'g', statut: 'publie', type_actu: null }];
    expect((await act('RETRY_FALC', ['g'])).statusCode).toBe(200);
  });
});
