/**
 * R7 admin — a single review-queue PATCH applies only to an OPEN item ('open' or 'OPEN'), like the bulk PATCH already did: a decided item is never
 * re-decided (409, nothing written, no audit row); an unknown item stays 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { before: null, updates: 0, audits: 0 };
const chain = (result) => { const c = { from: () => c, where: () => c, set: () => c, values: () => { state.audits += 1; return Promise.resolve(); }, returning: () => { state.updates += 1; return Promise.resolve(result()); }, then: (ok, ko) => Promise.resolve(result()).then(ok, ko) }; return c; };
vi.mock('../../src/db/index.js', () => ({
  db: {
    select: () => chain(() => (state.before ? [state.before] : [])),
    update: () => chain(() => (state.before ? [{ id: 'q1', status: 'resolved' }] : [])),
    insert: () => chain(() => []),
  },
}));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/auth.js', () => ({ verifyAdmin: vi.fn().mockResolvedValue(true) }));
vi.mock('../../api/_utils/admin-gate.js', () => ({ adminGate: vi.fn().mockResolvedValue({ email: 'admin@example.test', mfa_verified: true }) }));
vi.mock('../../api/_services/repair-suggestions.js', () => ({ suggestionsAllowed: () => false }));

const resOf = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const patch = async () => {
  const handler = (await import('../../api/_handlers/admin/review-queue.js')).default;
  const res = resOf();
  await handler({ method: 'PATCH', url: '/api/admin/review-queue/q1', headers: { host: 'localhost' }, query: {}, body: { status: 'resolved' } }, res);
  return res;
};

describe('R7 admin — single review-queue PATCH needs an open item', () => {
  beforeEach(() => { state.before = null; state.updates = 0; state.audits = 0; });
  it.each(['open', 'OPEN'])('decides an item in status %s', async (status) => {
    state.before = { status, details: {} };
    const r = await patch();
    expect([r.statusCode, state.updates, state.audits]).toEqual([200, 1, 1]);
  });
  it.each(['resolved', 'dismissed', 'ignored', 'resolved_by_ai'])('refuses an item already in status %s with 409 and writes nothing', async (status) => {
    state.before = { status, details: {} };
    const r = await patch();
    expect([r.statusCode, r.body.error, state.updates, state.audits]).toEqual([409, 'NOT_OPEN', 0, 0]);
  });
  it('an unknown item is 404', async () => {
    const r = await patch();
    expect([r.statusCode, state.audits]).toEqual([404, 0]);
  });
});
