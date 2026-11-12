// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — the administration screens show error.message: a 429 of the per-address admin limit (60 a minute) read « API Error: 429 ».
 * apiRequest now gives a sentence for 429 and 5xx answers; status and payload are unchanged, other statuses keep their technical message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../src/api/client.js';

const answer = (status, body) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
afterEach(() => vi.unstubAllGlobals());

describe('UX ecosystem: readable API error messages', () => {
  it('429: « too many requests » sentence, status and payload kept', async () => {
    answer(429, { error: 'Trop de tentatives.', code: 'RATE_LIMITED' });
    const e = await apiClient.admin.getWs2Queue().catch((x) => x);
    expect(e.status).toBe(429); expect(e.payload.code).toBe('RATE_LIMITED');
    expect(e.message).toMatch(/Trop de demandes en peu de temps/);
  });
  it('5xx: « the server did not respond » sentence', async () => {
    answer(503, { error: 'down' });
    const e = await apiClient.admin.getWs2Queue().catch((x) => x);
    expect(e.status).toBe(503); expect(e.message).toMatch(/Le serveur n'a pas répondu/);
  });
  it('other statuses keep the technical message the callers already handle', async () => {
    answer(404, { error: 'Not found' });
    const e = await apiClient.admin.getWs2Queue().catch((x) => x);
    expect(e.message).toBe('API Error: 404');
  });
});
