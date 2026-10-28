import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';

import {
  fetchProRdvReadiness,
  proRdvClient,
  validateAppointmentInput,
  validateTimeOffInput,
} from '../../src/api/pro-rdv-client.js';

const originalWindow = global.window;
const originalLocalStorage = global.localStorage;
const originalFetch = global.fetch;

function installToken(token = 'pro-test-token') {
  global.window = {};
  global.localStorage = {
    getItem(key) {
      if (key === 'pro_token') return token;
      return null;
    },
    setItem() {},
    removeItem() {},
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

afterEach(() => {
  global.window = originalWindow;
  global.localStorage = originalLocalStorage;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('pro rdv client', () => {
  it('validates appointment payload', () => {
    expect(validateAppointmentInput({ serviceId: '', startAt: '', beneficiaryName: '' })).toMatchObject({
      ok: false,
      error: 'serviceId is required',
    });

    expect(
      validateAppointmentInput({
        serviceId: 'service-1',
        startAt: '2026-03-01T09:00:00.000Z',
        beneficiaryName: 'Alice',
      }),
    ).toMatchObject({ ok: true });
  });

  it('validates time off payload', () => {
    expect(validateTimeOffInput({ startAt: '', endAt: '' })).toMatchObject({
      ok: false,
      error: 'startAt is required',
    });

    expect(
      validateTimeOffInput({
        startAt: '2026-03-01T09:00:00.000Z',
        endAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toMatchObject({ ok: true });
  });

  it('attaches pro bearer token for authenticated requests', async () => {
    installToken('pro-token-123');
    const fetchSpy = vi.fn(async (_url, init) => {
      expect(init?.headers?.Authorization).toBe('Bearer pro-token-123');
      return jsonResponse(200, []);
    });
    global.fetch = fetchSpy;

    const result = await proRdvClient.services.list();
    expect(Array.isArray(result)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('supports rdv settings update endpoint', async () => {
    installToken('pro-token-456');
    global.fetch = vi.fn(async (url, init) => {
      expect(url).toBe('/api/pro/rdv/settings');
      expect(init?.method).toBe('PUT');
      expect(init?.headers?.Authorization).toBe('Bearer pro-token-456');
      return jsonResponse(200, { isPublished: true, bookingMode: 'IN_PERSON' });
    });

    const result = await proRdvClient.settings.update({ isPublished: true });
    expect(result).toMatchObject({ isPublished: true, bookingMode: 'IN_PERSON' });
  });

  it('returns monitor readiness payload without requiring pro token', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { ok: true, missingTables: [] }));

    const result = await fetchProRdvReadiness('/api/monitor/pro-rdv');
    expect(result).toMatchObject({
      status: 200,
      payload: { ok: true, missingTables: [] },
    });
  });
});
