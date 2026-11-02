/**
 * R36 — the mail providers' bounded retry (api/_utils/mailer.js postWithRetry): a 429 is retried after its Retry-After (capped), at most twice; a 5xx or a
 * network error only with an idempotency key; a refusal (4xx) never. No real network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWithRetry } from '../../api/_utils/mailer.js';

const res = (status, headers = {}) => ({ status, ok: status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const run = async (answers, idempotent) => {
  const calls = []; const waits = [];
  vi.stubGlobal('fetch', async (url) => { calls.push(url); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; if (a instanceof Error) throw a; return a; });
  let out; let error = null;
  try { out = await postWithRetry('https://provider.test/send', { method: 'POST' }, { idempotent, sleep: async (ms) => { waits.push(ms); } }); } catch (e) { error = e; }
  return { calls: calls.length, waits, status: out?.status, error };
};
afterEach(() => vi.unstubAllGlobals());

describe('mail provider retry', () => {
  it('429 then accepted: retried after Retry-After (capped at 5 s)', async () => {
    expect(await run([res(429, { 'retry-after': '2' }), res(200)], false)).toMatchObject({ calls: 2, waits: [2000], status: 200 });
    expect(await run([res(429, { 'retry-after': '60' }), res(200)], false)).toMatchObject({ waits: [5000], status: 200 });
  });
  it('at most three attempts; the last answer is returned', async () => {
    expect(await run([res(429), res(429), res(429), res(200)], true)).toMatchObject({ calls: 3, waits: [500, 1000], status: 429 });
  });
  it('a 5xx or a network error is retried only with an idempotency key (no duplicate message without one)', async () => {
    expect(await run([res(503), res(200)], true)).toMatchObject({ calls: 2, status: 200 });
    expect(await run([res(503), res(200)], false)).toMatchObject({ calls: 1, status: 503 });
    expect(await run([new TypeError('reset'), res(200)], true)).toMatchObject({ calls: 2, status: 200 });
    const noKey = await run([new TypeError('reset'), res(200)], false);
    expect(noKey.calls).toBe(1); expect(noKey.error).toBeInstanceOf(TypeError);
  });
  it('a refusal (4xx other than 429) is final', async () => {
    expect(await run([res(422), res(200)], true)).toMatchObject({ calls: 1, status: 422 });
  });
});
