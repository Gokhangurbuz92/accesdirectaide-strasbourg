import { vi } from 'vitest';
vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sentryRef } from '../../src/observability/sentryRef.js';
import { proRdvRequest } from '../../src/api/pro-rdv-client.js';
import { rdvMessagingClient } from '../../src/api/rdv-messaging-client.js';

// R7 Sentry noise: expected refusals (401/403/404/409/429…) are normal answers, not incidents. Only 5xx and real network failures reach Sentry;
// an aborted request (the person left the page) is not a network failure.
const originalFetch = global.fetch; const originalWindow = global.window; const originalLocalStorage = global.localStorage;
let sentry;
const res = (status) => ({ ok: status < 400, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => ({ error: 'x' }), text: async () => '' });

beforeEach(() => {
  sentry = { captureMessage: vi.fn(), captureException: vi.fn() };
  sentryRef.current = sentry;
  global.window = {};
  global.localStorage = { getItem: (k) => (k === 'pro_token' ? 'pro-test-token' : null), setItem() {}, removeItem() {} };
});
afterEach(() => { sentryRef.current = null; global.fetch = originalFetch; global.window = originalWindow; global.localStorage = originalLocalStorage; });

const calls = () => sentry.captureMessage.mock.calls.length + sentry.captureException.mock.calls.length;

describe('rdv clients send only real failures to Sentry', () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    it(`messaging ${status} is not reported`, async () => {
      global.fetch = vi.fn(async () => res(status));
      await expect(rdvMessagingClient.user.listConversations()).rejects.toBeTruthy();
      expect(calls()).toBe(0);
    });
    it(`pro rdv ${status} is not reported`, async () => {
      global.fetch = vi.fn(async () => res(status));
      await expect(proRdvRequest('/api/pro/rdv/x')).rejects.toBeTruthy();
      expect(calls()).toBe(0);
    });
  }
  it('messaging 500 is reported as an error', async () => {
    global.fetch = vi.fn(async () => res(500));
    await expect(rdvMessagingClient.user.listConversations()).rejects.toBeTruthy();
    expect(sentry.captureMessage).toHaveBeenCalledWith('rdv_messaging_request_failed', { level: 'error' });
  });
  it('pro rdv 502 is reported as an error', async () => {
    global.fetch = vi.fn(async () => res(502));
    await expect(proRdvRequest('/api/pro/rdv/x')).rejects.toBeTruthy();
    expect(sentry.captureMessage).toHaveBeenCalledWith('pro_rdv_request_failed', { level: 'error' });
  });
  it('a real network failure is reported', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(rdvMessagingClient.user.listConversations()).rejects.toBeTruthy();
    await expect(proRdvRequest('/api/pro/rdv/x')).rejects.toBeTruthy();
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });
  it('an aborted request is not reported', async () => {
    global.fetch = vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    await expect(rdvMessagingClient.user.listConversations()).rejects.toBeTruthy();
    await expect(proRdvRequest('/api/pro/rdv/x')).rejects.toBeTruthy();
    expect(calls()).toBe(0);
  });
});
