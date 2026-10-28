/**
 * @typedef {{
 *   method?: string,
 *   body?: any,
 *   query?: Record<string, string | number | boolean | null | undefined>,
 *   signal?: AbortSignal,
 * }} ProRequestOptions
 */

class ApiError extends Error {
  /** @param {string} message @param {number} status @param {any} [payload] @param {string|null} [requestId] */
  constructor(message, status, payload, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.requestId = requestId;
  }
}

import { sentryRef } from '../observability/sentryRef.js';

/**
 * @returns {any}
 */
function getSentryClient() {
  const client = sentryRef.current;
  if (!client) return null;
  // @ts-ignore
  if (typeof client.captureException !== 'function' && typeof client.captureMessage !== 'function') {
    return null;
  }
  return client;
}

/**
 * @param {'network_error' | 'request_failed'} kind
 * @param {{ endpoint: string, method: string, status?: number, requestId?: string | null }} context
 * @param {unknown=} error
 */
function captureProRdvClientIssue(kind, context, error) {
  const Sentry = getSentryClient();
  if (!Sentry) return;

  const level = (context.status || 0) >= 500 ? 'error' : 'warning';
  const requestId = context.requestId || null;

  try {
    if (typeof Sentry.withScope === 'function') {
      Sentry.withScope((/** @type {{ setTag: (arg0: string, arg1: string) => void; setContext: (arg0: string, arg1: { endpoint: string; method: string; status: number | null; requestId: string | null; }) => void; }} */ scope) => {
        if (scope && typeof scope.setTag === 'function') {
          scope.setTag('module', 'rdv');
          scope.setTag('surface', 'pro-ui');
          scope.setTag('endpoint', context.endpoint);
          scope.setTag('http.method', context.method);
          if (typeof context.status === 'number') scope.setTag('http.status_code', String(context.status));
          if (requestId) scope.setTag('request_id', requestId);
        }
        if (scope && typeof scope.setContext === 'function') {
          scope.setContext('rdv_client', {
            endpoint: context.endpoint,
            method: context.method,
            status: typeof context.status === 'number' ? context.status : null,
            requestId,
          });
        }

        if (error && typeof Sentry.captureException === 'function') {
          Sentry.captureException(error);
          return;
        }
        if (typeof Sentry.captureMessage === 'function') {
          Sentry.captureMessage(`pro_rdv_${kind}`, { level });
        }
      });
      return;
    }

    if (error && typeof Sentry.captureException === 'function') {
      Sentry.captureException(error);
      return;
    }
    if (typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage(`pro_rdv_${kind}`, { level });
    }
  } catch {
    // best-effort: never break UI flow because Sentry failed
  }
}

/**
 * @returns {string | null}
 */
export function getProToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pro_token');
}

/**
 * @param {string} token
 */
export function buildProAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * @param {Record<string, string | number | boolean | null | undefined> | undefined} query
 * @returns {string}
 */
function buildQueryString(query) {
  if (!query || typeof query !== 'object') return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * @param {string} path
 * @param {ProRequestOptions=} options
 */
export async function proRdvRequest(path, options = {}) {
  const token = getProToken();
  if (!token) {
    throw new Error('Pro authentication required');
  }

  const endpoint = `${path}${buildQueryString(options.query)}`;
  const method = options.method || 'GET';

  /** @type {Response} */
  let response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: buildProAuthHeaders(token),
      body: typeof options.body === 'undefined' ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (networkError) {
    captureProRdvClientIssue(
      'network_error',
      { endpoint: path, method: String(method).toUpperCase() },
      networkError,
    );
    throw new Error('Pro API network error');
  }

  const requestId = response.headers.get('x-request-id');

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    captureProRdvClientIssue('request_failed', {
      endpoint: path,
      method: String(method).toUpperCase(),
      status: response.status,
      requestId,
    });

    const error = new ApiError(`Pro API error (${response.status})`, response.status, payload, requestId);
    throw error;
  }

  return payload;
}

/**
 * @param {string} path
 */
export async function fetchProRdvReadiness(path = '/api/monitor/pro-rdv') {
  let response;
  try {
    response = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (networkError) {
    captureProRdvClientIssue(
      'network_error',
      { endpoint: path, method: 'GET' },
      networkError,
    );
    throw networkError;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    status: response.status,
    payload,
  };
}

/**
 * @param {{ serviceId?: string, startAt?: string, beneficiaryName?: string }} input
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateAppointmentInput(input) {
  const serviceId = String(input?.serviceId || '').trim();
  const startAt = String(input?.startAt || '').trim();
  const beneficiaryName = String(input?.beneficiaryName || '').trim();

  if (!serviceId) return { ok: false, error: 'serviceId is required' };
  if (!startAt) return { ok: false, error: 'startAt is required' };
  if (!beneficiaryName) return { ok: false, error: 'beneficiaryName is required' };

  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: 'startAt must be a valid ISO date' };

  return { ok: true };
}

/**
 * @param {{ startAt?: string, endAt?: string }} input
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateTimeOffInput(input) {
  const startAt = String(input?.startAt || '').trim();
  const endAt = String(input?.endAt || '').trim();
  if (!startAt) return { ok: false, error: 'startAt is required' };
  if (!endAt) return { ok: false, error: 'endAt is required' };

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: 'Invalid time range' };
  }
  if (end <= start) return { ok: false, error: 'endAt must be greater than startAt' };
  return { ok: true };
}

export const proRdvClient = {
  services: {
    // PKG-3 / B01: the API answers { items, total }; the three screens (Services, agenda, new appointment) expected an ARRAY and therefore always showed no service.
    async list() {
      const payload = await proRdvRequest('/api/pro/services');
      return Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    },
    create(/** @type {string | number | boolean | null | undefined} */ payload) {
      return proRdvRequest('/api/pro/services', { method: 'POST', body: payload });
    },
    update(/** @type {string | number | boolean | null | undefined} */ id, /** @type {string | number | boolean | null | undefined} */ payload) {
      return proRdvRequest('/api/pro/services', { method: 'PATCH', query: { id }, body: payload });
    },
    remove(/** @type {string | number | boolean | null | undefined} */ id) {
      return proRdvRequest('/api/pro/services', { method: 'DELETE', query: { id } });
    },
  },
  settings: {
    get() {
      return proRdvRequest('/api/pro/rdv/settings');
    },
    /**
     * @param {{ isPublished: boolean; bookingMode: string; contactEmail: string | null; contactPhone: string | null; }} payload
     */
    update(payload) {
      return proRdvRequest('/api/pro/rdv/settings', { method: 'PUT', body: payload });
    },
  },
  availability: {
    get() {
      return proRdvRequest('/api/pro/availability');
    },
    replace(/** @type {{ rules: string | number | boolean | null | undefined, slots_json: string | number | boolean | null | undefined, timezone: string | number | boolean | null | undefined }} */ rulesOrPayload, timezone = 'Europe/Paris') {
      /** @type {Record<string, any>} */
      let body = { rules: [], timezone };
      if (Array.isArray(rulesOrPayload)) {
        body = { rules: rulesOrPayload, timezone };
      } else if (rulesOrPayload && typeof rulesOrPayload === 'object') {
        if (Array.isArray(rulesOrPayload.rules)) {
          body = {
            rules: rulesOrPayload.rules,
            timezone: rulesOrPayload.timezone || timezone,
          };
        } else if (rulesOrPayload.slots_json && typeof rulesOrPayload.slots_json === 'object') {
          body = {
            slots_json: rulesOrPayload.slots_json,
            timezone: rulesOrPayload.timezone || timezone,
          };
        }
      }
      return proRdvRequest('/api/pro/availability', {
        method: 'PUT',
        body,
      });
    },
  },
  slots: {
    list(/** @type {{ from: string | number | boolean | null | undefined, serviceId: string | number | boolean | null | undefined, to: string | number | boolean | null | undefined }} */ input) {
      return proRdvRequest('/api/pro/slots', {
        query: {
          serviceId: input?.serviceId,
          from: input?.from,
          to: input?.to,
          // @ts-ignore PKG-3 modality (default in person on the server)
          mode: input?.mode,
        },
      });
    },
  },
  appointments: {
    list(filters = {}) {
      return proRdvRequest('/api/pro/appointments', { query: filters });
    },
    create(/** @type {Record<string, string | number | boolean | null | undefined>} */ payload) {
      const validation = validateAppointmentInput(payload);
      if (!validation.ok) throw new Error(validation.error || 'Invalid appointment payload');
      return proRdvRequest('/api/pro/appointments', { method: 'POST', body: payload });
    },
    update(/** @type {string | number | boolean | null | undefined} */ id, /** @type {Record<string, string | number | boolean | null | undefined>} */ payload) {
      return proRdvRequest('/api/pro/appointments', {
        method: 'PATCH',
        body: { id, ...(payload || {}) },
      });
    },
    cancelLegacy(/** @type {string | number | boolean | null | undefined} */ id) {
      return proRdvRequest('/api/pro/appointments/cancel', {
        method: 'POST',
        body: { id },
      });
    },
  },
  timeoff: {
    list(filters = {}) {
      return proRdvRequest('/api/pro/timeoff', { query: filters });
    },
    /**
     * @param {{ startAt: string | undefined; endAt: string | undefined; reason?: string; }} payload
     */
    create(payload) {
      const validation = validateTimeOffInput(payload);
      if (!validation.ok) throw new Error(validation.error || 'Invalid time off payload');
      return proRdvRequest('/api/pro/timeoff', { method: 'POST', body: payload });
    },
    /**
     * @param {string} id
     * @param {{ startAt: string; endAt: string; reason: string; }} payload
     */
    update(id, payload) {
      return proRdvRequest('/api/pro/timeoff', {
        method: 'PATCH',
        body: { id, ...(payload || {}) },
      });
    },
    remove(/** @type {string | number | boolean | null | undefined} */ id) {
      return proRdvRequest('/api/pro/timeoff', { method: 'DELETE', query: { id } });
    },
  },
};

export default proRdvClient;
