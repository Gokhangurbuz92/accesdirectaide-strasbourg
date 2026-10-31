// @ts-nocheck
import { ensureCsrfHeaders } from '@/lib/csrf';
import { frontendEnv } from '@/config/env';

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

import { sentryRef } from '@/observability/sentryRef.js';

/**
 * @returns {any}
 */
function getSentryClient() {
  const client = sentryRef.current;
  if (!client) return null;
  if (typeof client.captureException !== 'function' && typeof client.captureMessage !== 'function') {
    return null;
  }
  return client;
}

/**
 * @param {'network_error' | 'request_failed'} kind
 * @param {{ endpoint: string, method: string, surface: string, status?: number, requestId?: string | null }} context
 * @param {unknown=} error
 */
function captureMessagingIssue(kind, context, error) {
  const Sentry = getSentryClient();
  if (!Sentry) return;

  const level = (context.status || 0) >= 500 ? 'error' : 'warning';

  try {
    if (typeof Sentry.withScope === 'function') {
      Sentry.withScope((scope) => {
        if (scope && typeof scope.setTag === 'function') {
          scope.setTag('module', 'rdv');
          scope.setTag('surface', context.surface);
          scope.setTag('endpoint', context.endpoint);
          scope.setTag('http.method', context.method);
          if (typeof context.status === 'number') scope.setTag('http.status_code', String(context.status));
          if (context.requestId) scope.setTag('request_id', context.requestId);
        }

        if (scope && typeof scope.setContext === 'function') {
          scope.setContext('rdv_messaging', {
            endpoint: context.endpoint,
            method: context.method,
            status: typeof context.status === 'number' ? context.status : null,
            requestId: context.requestId || null,
          });
        }

        if (error && typeof Sentry.captureException === 'function') {
          Sentry.captureException(error);
          return;
        }

        if (typeof Sentry.captureMessage === 'function') {
          Sentry.captureMessage(`rdv_messaging_${kind}`, { level });
        }
      });
      return;
    }

    if (error && typeof Sentry.captureException === 'function') {
      Sentry.captureException(error);
      return;
    }

    if (typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage(`rdv_messaging_${kind}`, { level });
    }
  } catch {
    // best effort
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: any, auth?: 'user' | 'pro', signal?: AbortSignal }=} options
 */
async function requestJson(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const auth = options.auth || 'user';

  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json',
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  // PKG-4 (found by DTA-B33 through the real entry): a citizen's state-changing call rides on the session COOKIE, so it needs the double-submit CSRF header —
  // without it every message the person sent was refused (403). When no CSRF cookie can be obtained (e.g. a mock backend) the request is sent as before and the
  // server's check stays the only authority (same rule as the booking screen).
  if (auth === 'user' && method !== 'GET') {
    const csrf = await ensureCsrfHeaders().catch(() => null);
    if (csrf) Object.assign(headers, csrf);
  }

  if (auth === 'pro') {
    const proToken = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;
    if (!proToken) {
      const error = new ApiError('Pro authentication required', 401);
      throw error;
    }
    headers.Authorization = `Bearer ${proToken}`;
  }

  /** @type {Response} */
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: auth === 'user' ? 'include' : 'same-origin',
      headers,
      body: typeof options.body === 'undefined' ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (networkError) {
    captureMessagingIssue(
      'network_error',
      {
        endpoint: path,
        method,
        surface: auth === 'user' ? 'user-messaging' : 'pro-messaging',
      },
      networkError,
    );
    const error = new ApiError('Network error', 0);
    throw error;
  }

  const requestId = response.headers.get('x-request-id');
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    captureMessagingIssue('request_failed', {
      endpoint: path,
      method,
      surface: auth === 'user' ? 'user-messaging' : 'pro-messaging',
      status: response.status,
      requestId,
    });

    const message = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
    const error = new ApiError(message, response.status, payload, requestId);
    throw error;
  }

  return payload;
}

import { cryptoE2EE } from '@/lib/crypto-messaging.js';

/**
 * Décrypte les messages d'une conversation s'ils sont chiffrés E2EE.
 */
async function decryptConversation(data, conversationId) {
  if (!data?.item?.messages) return data;

  data.item.messages = await Promise.all(
    data.item.messages.map(async (msg) => {
      if (msg.body && msg.body.startsWith('E2EE:')) {
        try {
          msg.body = await cryptoE2EE.decrypt(msg.body.slice(5), conversationId);
        } catch (err) {
          // Fallback géré par le try/catch interne de cryptoE2EE s'il échoue, 
          // mais par sécurité.
        }
      }
      return msg;
    })
  );

  return data;
}

/**
 * Décrypte les derniers messages (lastMessage) dans une liste de conversations.
 */
async function decryptConversationList(data) {
  if (!data?.items) return data;

  data.items = await Promise.all(
    data.items.map(async (conv) => {
      if (conv.lastMessage?.body?.startsWith('E2EE:')) {
        try {
          conv.lastMessage.body = await cryptoE2EE.decrypt(conv.lastMessage.body.slice(5), conv.id);
        } catch (err) {
          // fallback
        }
      }
      return conv;
    })
  );

  return data;
}

export const rdvMessagingClient = {
  authMe() {
    // R29: no account can exist in the public beta — the visitor is anonymous without asking the server (one refused request per page before)
    if (frontendEnv.flags.publicBeta) return Promise.resolve({ authenticated: false, session: null });
    return requestJson('/api/auth/me', { auth: 'user' });
  },
  user: {
    async listConversations() {
      const data = await requestJson('/api/messages/conversations', { auth: 'user' });
      return decryptConversationList(data);
    },
    async getConversation(conversationId) {
      const data = await requestJson(`/api/messages/conversations/${encodeURIComponent(conversationId)}`, { auth: 'user' });
      return decryptConversation(data, conversationId);
    },
    async sendMessage(conversationId, body, attachment) {
      // owner usefulness pass (2026-10-25): the text is sent as typed (over TLS) and the server encrypts it at rest with its own key (v1:, rdv-messaging.js).
      // The former browser layer (« E2EE: », a key derived from the conversation id the server knows — not end-to-end, see crypto-messaging.js) made the
      // conversation previews and the appointment tab show ciphertext, and the server's 2000-character limit cut long messages into undecryptable text.
      // Messages already stored in that format are still decrypted on reading (decryptConversation / decryptConversationList).
      const finalBody = body ? String(body) : undefined;

      const data = await requestJson(`/api/messages/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'POST',
        auth: 'user',
        body: { body: finalBody, ...(attachment ? { attachment } : {}) },   // PKG-4 / R14
      });

      // Décrypter le message renvoyé dans la réponse si nécessaire
      if (data?.item?.body?.startsWith('E2EE:')) {
        data.item.body = await cryptoE2EE.decrypt(data.item.body.slice(5), conversationId);
      }

      return data;
    },
    /** PKG-4 / R14: the raw download response (the caller saves it). */
    downloadAttachment(conversationId, attachmentId) {
      return fetch(`/api/messages/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`, { credentials: 'include' });
    },
    getOrCreateFromAppointment(appointmentId) {
      return requestJson(`/api/messages/from-appointment/${encodeURIComponent(appointmentId)}`, {
        method: 'POST',
        auth: 'user',
      });
    },
  },
  pro: {
    /** PKG-4 / R14: the raw download response (the caller saves it). */
    downloadAttachment(conversationId, attachmentId) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;
      return fetch(`/api/pro/messages/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    },
    async listConversations() {
      const data = await requestJson('/api/pro/messages/conversations', { auth: 'pro' });
      return decryptConversationList(data);
    },
    async getConversation(conversationId) {
      const data = await requestJson(`/api/pro/messages/conversations/${encodeURIComponent(conversationId)}`, { auth: 'pro' });
      return decryptConversation(data, conversationId);
    },
    async sendMessage(conversationId, body, attachment) {
      // owner usefulness pass (2026-10-25): the text is sent as typed (over TLS) and the server encrypts it at rest with its own key (v1:, rdv-messaging.js).
      // The former browser layer (« E2EE: », a key derived from the conversation id the server knows — not end-to-end, see crypto-messaging.js) made the
      // conversation previews and the appointment tab show ciphertext, and the server's 2000-character limit cut long messages into undecryptable text.
      // Messages already stored in that format are still decrypted on reading (decryptConversation / decryptConversationList).
      const finalBody = body ? String(body) : undefined;

      const data = await requestJson(`/api/pro/messages/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'POST',
        auth: 'pro',
        body: { body: finalBody, ...(attachment ? { attachment } : {}) },   // PKG-4 / R14
      });

      if (data?.item?.body?.startsWith('E2EE:')) {
        data.item.body = await cryptoE2EE.decrypt(data.item.body.slice(5), conversationId);
      }

      return data;
    },
  },
};

/**
 * @param {any} error
 * @param {string=} fallback
 */
export function messagingErrorText(error, fallback = 'Une erreur est survenue.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error?.payload?.error && typeof error.payload.error === 'string') return error.payload.error;
  if (error?.message && typeof error.message === 'string') return error.message;
  return fallback;
}
