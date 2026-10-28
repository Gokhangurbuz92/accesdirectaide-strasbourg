/**
 * R12 (C02) — professional password reset: the new password and the end of every session are ONE update; when that write fails, the single-use link is put back
 * (the person can try again) instead of being burnt with the old password still in place.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ store: new Map(), fail: false, sets: [] }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  get: async (k) => S.store.get(k) ?? null,
  del: async (k) => (S.store.delete(k) ? 1 : 0),
  set: async (k, v) => { S.store.set(k, v); },
} }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock('../../api/_utils/user-auth.js', () => ({ hashPassword: async () => 'hashed' }));
vi.mock('../../api/_utils/auth.js', () => ({ logProAudit: async () => {} }));
vi.mock('../../api/_utils/client-ip.js', () => ({ clientIp: () => '10.0.0.1' }));
vi.mock('../../src/db/index.js', () => ({ db: { update: () => ({ set: (v) => { S.sets.push(v); return { where: () => ({ returning: async () => { if (S.fail) throw new Error('db down'); return [{ id: 'u1', structureId: 's1' }]; } }) }; } }) } }));

import crypto from 'node:crypto';
import handler from '../../api/_handlers/pro/auth/reset-password.js';

const TOKEN = 'a'.repeat(64);
const KEY = `reset:pro:${crypto.createHash('sha256').update(TOKEN).digest('hex')}`;
const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {} });
const call = async () => { const r = mk(); await handler({ method: 'POST', headers: {}, body: { token: TOKEN, password: 'Synthetic-QA-pass-0001' } }, r); return r; };
beforeEach(() => { S.store = new Map([[KEY, { userId: 'u1' }]]); S.fail = false; S.sets = []; });

describe('pro password reset', () => {
  it('success: one update sets the password AND ends the sessions; the link is used once', async () => {
    expect((await call()).statusCode).toBe(200);
    expect(S.sets).toHaveLength(1);
    expect(Object.keys(S.sets[0]).sort()).toEqual(['password_hash', 'sessionsValidAfter']);
    expect(S.store.has(KEY)).toBe(false);
    expect((await call()).statusCode).toBe(400);
  });
  it('a failed write puts the link back (not burnt), and the retry works', async () => {
    S.fail = true;
    expect((await call()).statusCode).toBe(500);
    expect(S.store.get(KEY)).toEqual({ userId: 'u1' });
    S.fail = false;
    expect((await call()).statusCode).toBe(200);
  });
});
