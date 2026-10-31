// PKG-1 / K0 — thin client of /api/citizen/* (cookie session; protected writes go through csrfFetch: bootstrap + one safe retry). Errors keep the server's code and message so screens can be specific.
import { csrfFetch, CsrfBootstrapError } from '@/lib/csrf';

export class CitizenApiError extends Error {
  /** @param {string} message @param {number} status @param {string} [code] */
  constructor(message, status, code) {
    super(message);
    this.name = 'CitizenApiError';
    this.status = status;
    this.code = code || '';
  }
}

/** @param {string} path @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [opts] */
async function call(path, opts = {}) {
  const method = opts.method || 'GET';
  const init = {
    method,
    credentials: /** @type {RequestCredentials} */ ('same-origin'),
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  let res;
  try {
    res = method === 'GET' ? await fetch(path, init) : await csrfFetch(path, init);
  } catch (err) {
    if (err instanceof CsrfBootstrapError) throw new CitizenApiError('Impossible de préparer la requête sécurisée. Rechargez la page puis réessayez.', 0, 'csrf_bootstrap');
    throw new CitizenApiError('Le service est momentanément injoignable. Réessayez dans un instant.', 0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = res.status === 401 ? 'Connectez-vous pour accéder à votre espace.' : res.status === 429 ? 'Trop de demandes, patientez un instant.' : 'Une erreur est survenue.';
    throw new CitizenApiError(data.message || fallback, res.status, data.error);
  }
  return data;
}

export const citizenApi = {
  getProfile: async () => (await call('/api/citizen/profile')).account,
  saveProfile: (/** @type {Record<string, unknown>} */ patch) => call('/api/citizen/profile', { method: 'PUT', body: patch }),
  // launch-readiness item 66: rectification of the contact data
  requestEmailChange: (/** @type {{ newEmail: string, password: string }} */ input) => call('/api/citizen/email-change', { method: 'POST', body: input }),
  setPhone: (/** @type {string | null} */ phone) => call('/api/citizen/phone', { method: 'PUT', body: { phone } }),
  addMember: (/** @type {Record<string, unknown>} */ member) => call('/api/citizen/household', { method: 'POST', body: member }),
  removeMember: (/** @type {string} */ id) => call('/api/citizen/household', { method: 'DELETE', body: { id } }),
  // C05 (R30): the minor ↔ legal guardian link
  listGuardians: () => call('/api/citizen/guardians'),
  guardianAction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/guardians', { method: 'POST', body }),
  setPreference: (/** @type {Record<string, unknown>} */ pref) => call('/api/citizen/preferences', { method: 'PUT', body: pref }),
  // R11 / N04: notifications on this device (Web Push)
  pushStatus: () => call('/api/citizen/push'),
  pushSubscribe: (/** @type {unknown} */ subscription) => call('/api/citizen/push', { method: 'POST', body: { subscription } }),
  pushUnsubscribe: (/** @type {string | null} */ endpoint) => call('/api/citizen/push', { method: 'DELETE', body: endpoint ? { endpoint } : {} }),
  listShares: () => call('/api/citizen/shares'),
  claimShare: (/** @type {string} */ shareId, /** @type {string} */ ownerSecret) => call('/api/citizen/shares', { method: 'POST', body: { shareId }, headers: { 'X-Share-Owner-Secret': ownerSecret } }),
  // PKG-2 / K2 Mon Espace
  espace: async () => (await call('/api/citizen/espace')).summary,
  listParcours: () => call('/api/citizen/parcours'),
  parcoursHistory: (/** @type {string} */ id) => call(`/api/citizen/parcours?history=${encodeURIComponent(id)}`),
  parcours: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/parcours', { method: 'POST', body }),
  removeParcours: (/** @type {string} */ id) => call('/api/citizen/parcours', { method: 'DELETE', body: { id } }),
  listFavorites: () => call('/api/citizen/favorites'),
  addFavorite: (/** @type {string} */ entityType, /** @type {string} */ entityId) => call('/api/citizen/favorites', { method: 'POST', body: { entityType, entityId } }),
  removeFavorite: (/** @type {string} */ entityType, /** @type {string} */ entityId) => call('/api/citizen/favorites', { method: 'DELETE', body: { entityType, entityId } }),
  getHistory: () => call('/api/citizen/history'),
  setHistoryEnabled: (/** @type {boolean} */ enabled) => call('/api/citizen/history', { method: 'PUT', body: { enabled } }),
  addHistory: (/** @type {Record<string, unknown>} */ entry) => call('/api/citizen/history', { method: 'POST', body: entry }),
  clearHistory: (/** @type {string | undefined} */ id) => call('/api/citizen/history', { method: 'DELETE', body: id ? { id } : {} }),
  listCoffre: () => call('/api/citizen/coffre'),
  uploadCoffre: (/** @type {Record<string, unknown>} */ doc) => call('/api/citizen/coffre', { method: 'POST', body: doc }),
  deleteCoffre: (/** @type {string} */ id) => call('/api/citizen/coffre', { method: 'DELETE', body: { id } }),
  coffreDownloadUrl: (/** @type {string} */ id) => `/api/citizen/coffre?download=${encodeURIComponent(id)}`,
  shareFromCoffre: (/** @type {string} */ documentId, /** @type {string} */ shareId, /** @type {string} */ structureId) => call('/api/citizen/coffre', { method: 'POST', body: { action: 'share', documentId, shareId, structureId } }),
  // PKG-2 / R16 + C17 — a dossier attached to the account
  dossierAccess: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=access&shareId=${encodeURIComponent(shareId)}`),
  dossierDocuments: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=documents&shareId=${encodeURIComponent(shareId)}`),
  dossierDocumentUrl: (/** @type {string} */ shareId, /** @type {string} */ fileId) => `/api/citizen/dossier?shareId=${encodeURIComponent(shareId)}&download=${encodeURIComponent(fileId)}`,
  removeDossierDocument: (/** @type {string} */ shareId, /** @type {string} */ fileId) => call('/api/citizen/dossier', { method: 'DELETE', body: { shareId, fileId } }),
  dossierGrants: (/** @type {string} */ shareId) => call('/api/public/dossier-grants', { method: 'POST', body: { shareId, action: 'list' } }),
  // PKG-2 / C23 — delegation (read-only, scoped, time-limited, revocable)
  listDelegations: () => call('/api/citizen/delegations'),
  inviteDelegate: (/** @type {Record<string, unknown>} */ input) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'invite', ...input } }),
  respondDelegation: (/** @type {string} */ token, /** @type {boolean} */ accept) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'respond', token, accept } }),
  endDelegation: (/** @type {string} */ id) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'end', id } }),
  delegationLog: (/** @type {string} */ id) => call(`/api/citizen/delegations?log=${encodeURIComponent(id)}`),
  delegateView: (/** @type {string} */ id, /** @type {string} */ view) => call(`/api/citizen/delegations?id=${encodeURIComponent(id)}&view=${encodeURIComponent(view)}`),
  // PKG-3 / K3 — my appointments: list, cancel, reschedule (D-2), free slots of the same service
  // PKG-4 — referrals proposed by organizations (nothing is shared before 'accept') and the follow-ups of a dossier
  referrals: () => call('/api/citizen/referrals'),
  decideReferral: (/** @type {string} */ id, /** @type {'accept'|'refuse'} */ decision) => call('/api/citizen/referrals', { method: 'POST', body: { id, decision } }),
  dossierFollowUps: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=followups&shareId=${encodeURIComponent(shareId)}`),
  myAppointments: () => call('/api/rdv/appointments'),
  cancelAppointment: (/** @type {string} */ id) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  rescheduleAppointment: (/** @type {string} */ id, /** @type {string} */ startAt, /** @type {Record<string, unknown>} */ extra = {}) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/reschedule`, { method: 'POST', body: { startAt, ...extra } }),
  appointmentVisio: (/** @type {string} */ id, /** @type {string} */ action) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/visio`, { method: 'POST', body: { action } }),
  bookingServices: (/** @type {string} */ slug) => call(`/api/rdv/structures/${encodeURIComponent(slug)}/services`),
  freeSlots: (/** @type {string} */ slug, /** @type {string} */ serviceId, /** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ mode = 'IN_PERSON') =>
    call(`/api/rdv/structures/${encodeURIComponent(slug)}/slots?serviceId=${encodeURIComponent(serviceId)}&mode=${encodeURIComponent(mode)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};
