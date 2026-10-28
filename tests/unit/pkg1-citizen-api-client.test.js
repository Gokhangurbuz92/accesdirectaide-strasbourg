// @vitest-environment jsdom
// PKG-1 / K0 — the account client: reads are plain GETs, every write goes through csrfFetch (bootstrap + one safe retry), errors keep the server's own message and code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const csrf = vi.hoisted(() => ({ csrfFetch: vi.fn(), CsrfBootstrapError: class extends Error {} }));
vi.mock('../../src/lib/csrf.ts', () => csrf);

import { citizenApi, CitizenApiError } from '../../src/lib/citizenApi.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
beforeEach(() => { csrf.csrfFetch.mockReset(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

describe('citizenApi', () => {
  it('reads use a plain same-origin GET (no CSRF header needed)', async () => {
    fetch.mockResolvedValue(json(200, { profile: {} }));
    await citizenApi.getProfile();
    expect(fetch).toHaveBeenCalledWith('/api/citizen/profile', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
    expect(csrf.csrfFetch).not.toHaveBeenCalled();
  });
  it('writes go through csrfFetch with a JSON body on the right route and verb', async () => {
    csrf.csrfFetch.mockResolvedValue(json(200, { ok: true }));
    await citizenApi.setPreference({ channel: 'sms', category: 'service', enabled: true, consentGiven: true });
    await citizenApi.removeMember('m1');
    await citizenApi.claimShare('s1', 'secret');
    const calls = csrf.csrfFetch.mock.calls.map(([url, init]) => [url, init.method, init.body, init.headers]);
    expect(calls[0].slice(0, 3)).toEqual(['/api/citizen/preferences', 'PUT', JSON.stringify({ channel: 'sms', category: 'service', enabled: true, consentGiven: true })]);
    expect(calls[1].slice(0, 3)).toEqual(['/api/citizen/household', 'DELETE', JSON.stringify({ id: 'm1' })]);
    expect(calls[2][0]).toBe('/api/citizen/shares');
    expect(calls[2][3]).toMatchObject({ 'X-Share-Owner-Secret': 'secret', 'Content-Type': 'application/json' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the server code and message; falls back to a specific sentence for 401 and 429', async () => {
    fetch.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(429, {}));
    await expect(citizenApi.getProfile()).rejects.toMatchObject({ status: 401, message: expect.stringContaining('Connectez-vous') });
    await expect(citizenApi.listShares()).rejects.toMatchObject({ status: 429, message: expect.stringContaining('Trop de demandes') });
    csrf.csrfFetch.mockResolvedValue(json(409, { error: 'AGE_POLICY_PENDING', message: 'Raison précise' }));
    const err = await citizenApi.saveProfile({}).catch((e) => e);
    expect(err).toBeInstanceOf(CitizenApiError);
    expect([err.status, err.code, err.message]).toEqual([409, 'AGE_POLICY_PENDING', 'Raison précise']);
  });
  it('a network failure or a CSRF bootstrap failure is a readable error, not a raw exception', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(citizenApi.getProfile()).rejects.toMatchObject({ code: 'network', message: expect.not.stringContaining('Failed to fetch') });
    csrf.csrfFetch.mockRejectedValue(new csrf.CsrfBootstrapError());
    await expect(citizenApi.saveProfile({})).rejects.toMatchObject({ code: 'csrf_bootstrap' });
  });
});
