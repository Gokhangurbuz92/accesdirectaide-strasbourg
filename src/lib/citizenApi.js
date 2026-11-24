// PKG-1 / K0 — thin client of /api/citizen/* (cookie session; protected writes go through csrfFetch: bootstrap + one safe retry). Errors keep the server's code and status.
// A-13: `message` is the sentence to SHOW, in the interface language (src/lib/citizenErrors.js); the server's French sentence stays in `serverMessage`.
import { csrfFetch, CsrfBootstrapError } from '@/lib/csrf';
import { citizenErrorText } from '@/lib/citizenErrors';
import { hdsRequest, hdsVaultMode } from '@/lib/hdsClient';

export class CitizenApiError extends Error {
  /** @param {string} message @param {number} status @param {string} [code] @param {string} [serverMessage] */
  constructor(message, status, code, serverMessage) {
    super(message);
    this.name = 'CitizenApiError';
    this.status = status;
    this.code = code || '';
    this.serverMessage = serverMessage || '';
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
    if (err instanceof CsrfBootstrapError) throw new CitizenApiError(citizenErrorText({ code: 'csrf_bootstrap' }), 0, 'csrf_bootstrap');
    throw new CitizenApiError(citizenErrorText({ code: 'network' }), 0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverMessage = typeof data.message === 'string' ? data.message : '';
    throw new CitizenApiError(citizenErrorText({ code: data.error, status: res.status, serverMessage }), res.status, typeof data.error === 'string' ? data.error : '', serverMessage);
  }
  return data;
}

/**
 * G14-R3: Mon Coffre goes to the HDS service when the main API hands out a ticket; otherwise (LAB without an HDS service) the legacy route.
 * @param {string} path @param {{ method?: string, body?: unknown }} opts @param {() => Promise<any>} legacy
 */
async function vaultCall(path, opts, legacy) {
  let out;
  try { out = await hdsRequest('citizen.vault', path, opts); } catch (e) {
    const f = /** @type {{ status?: number, code?: string, serverMessage?: string }} */ (e);
    throw new CitizenApiError(citizenErrorText({ code: f.code, status: f.status, serverMessage: f.serverMessage }), f.status || 0, f.code, f.serverMessage);
  }
  return out === null ? legacy() : out;
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
  // R46 / N03: in-app notifications (kind, time, link — never a content)
  notifications: () => call('/api/citizen/notifications'),
  markNotificationsRead: () => call('/api/citizen/notifications', { method: 'POST', body: { action: 'read-all' } }),
  // R46 / N08: FranceConnect (OIDC adapter, not live): status line, link / unlink, logout through the provider
  franceConnectStatus: () => call('/api/auth/franceconnect/status'),
  franceConnectUnlink: () => call('/api/auth/franceconnect/unlink', { method: 'POST', body: {} }),
  // PKG-11 / C21 restriction of processing (art. 18) and A-20 objection (art. 21): one route; A-13 remainder: refusals in the interface language
  restrictionState: () => call('/api/citizen/restriction'),
  restriction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/restriction', { method: 'POST', body }),
  // PKG-2 / K2 Mon Espace
  espace: async () => (await call('/api/citizen/espace')).summary,
  listParcours: () => call('/api/citizen/parcours'),
  parcoursHistory: (/** @type {string} */ id) => call(`/api/citizen/parcours?history=${encodeURIComponent(id)}`),
  parcours: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/parcours', { method: 'POST', body }),
  removeParcours: (/** @type {string} */ id) => call('/api/citizen/parcours', { method: 'DELETE', body: { id } }),
  // G14 (limited Mon Parcours): the published places of an allowed kind for one step type, by name or town (nothing stored)
  parcoursStructures: (/** @type {string} */ stepType, /** @type {string} */ q) => call(`/api/citizen/parcours?structuresFor=${encodeURIComponent(stepType)}&q=${encodeURIComponent(q)}`),
  listFavorites: () => call('/api/citizen/favorites'),
  // X04 (expansion): the person's event registrations (closed by default: capability community.events)
  myEvents: () => call('/api/citizen/events'),
  eventAction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/events', { method: 'POST', body }),
  // X02 (expansion): the person's testimonials, withdrawal, reports (closed by default: capability community.testimonials)
  myTestimonials: () => call('/api/citizen/testimonials'),
  testimonialAction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/testimonials', { method: 'POST', body }),
  // X01 (expansion): the person's community pseudonym and stories, withdrawal, reports (closed by default: capability community.stories)
  myStories: () => call('/api/citizen/stories'),
  storyAction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/stories', { method: 'POST', body }),
  // X03 (expansion): Entraide — the person's membership, offers, requests, contacts, reports, blocks (closed by default: capability community.entraide)
  myEntraide: () => call('/api/citizen/entraide'),
  browseEntraide: (/** @type {string} */ category, /** @type {string} */ area) => call('/api/citizen/entraide?view=browse&category=' + encodeURIComponent(category || '') + '&area=' + encodeURIComponent(area || '')),
  entraideAction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/entraide', { method: 'POST', body }),
  // G14 / DSA art. 17, 20: the moderation decisions about my content or my reports, and my appeals (closed while no content capability is open)
  myModeration: () => call('/api/citizen/moderation'),
  moderationAppeal: (/** @type {string} */ decisionId, /** @type {string} */ body) => call('/api/citizen/moderation', { method: 'POST', body: { action: 'appeal', decisionId, body } }),
  addFavorite: (/** @type {string} */ entityType, /** @type {string} */ entityId) => call('/api/citizen/favorites', { method: 'POST', body: { entityType, entityId } }),
  removeFavorite: (/** @type {string} */ entityType, /** @type {string} */ entityId) => call('/api/citizen/favorites', { method: 'DELETE', body: { entityType, entityId } }),
  getHistory: () => call('/api/citizen/history'),
  setHistoryEnabled: (/** @type {boolean} */ enabled) => call('/api/citizen/history', { method: 'PUT', body: { enabled } }),
  addHistory: (/** @type {Record<string, unknown>} */ entry) => call('/api/citizen/history', { method: 'POST', body: entry }),
  clearHistory: (/** @type {string | undefined} */ id) => call('/api/citizen/history', { method: 'DELETE', body: id ? { id } : {} }),
  // G14-R3: with the HDS service the list is END-TO-END encrypted ({ e2e: true, keyring, documents: [{ id, meta, dek, … }] }); the page opens it with the vault key
  listCoffre: async () => { const out = await vaultCall('/v1/vault/documents', {}, () => call('/api/citizen/coffre')); return hdsVaultMode() === 'hds' ? { ...out, e2e: true } : out; },
  /** with the HDS service `doc` is the encrypted { content, meta, dek, expiresAt? } of src/lib/vaultCrypto.js; otherwise the LAB form */
  uploadCoffre: (/** @type {Record<string, unknown>} */ doc) => vaultCall('/v1/vault/documents', { method: 'POST', body: doc }, () => call('/api/citizen/coffre', { method: 'POST', body: doc })),
  setCoffreKeyring: (/** @type {unknown} */ keyring) => vaultCall('/v1/vault/keyring', { method: 'PUT', body: { keyring } }, async () => { throw new CitizenApiError(citizenErrorText({ code: 'HDS_GATEWAY_NOT_CONFIGURED', status: 503 }), 503, 'HDS_GATEWAY_NOT_CONFIGURED'); }),
  deleteCoffre: (/** @type {string} */ id) => vaultCall(`/v1/vault/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }, () => call('/api/citizen/coffre', { method: 'DELETE', body: { id } })),
  coffreDownloadUrl: (/** @type {string} */ id) => `/api/citizen/coffre?download=${encodeURIComponent(id)}`,
  // G14-R3: with the HDS service the encrypted document is fetched with a ticket, opened in the page and saved from memory (a plain link cannot carry the ticket)
  coffreViaHds: () => hdsVaultMode() === 'hds',
  downloadCoffre: (/** @type {string} */ id) => vaultCall(`/v1/vault/documents/${encodeURIComponent(id)}/content`, {}, async () => null),
  shareFromCoffre: async (/** @type {string} */ documentId, /** @type {string} */ shareId, /** @type {string} */ structureId) => {
    // shared dossiers are not ported to the HDS service yet: no copy of an HDS document to a Vercel-side dossier
    if (hdsVaultMode() === 'hds') throw new CitizenApiError(citizenErrorText({ code: 'HDS_MODULE_NOT_PORTED', status: 503 }), 503, 'HDS_MODULE_NOT_PORTED');
    return call('/api/citizen/coffre', { method: 'POST', body: { action: 'share', documentId, shareId, structureId } });
  },
  // PKG-2 / R16 + C17 — a dossier attached to the account
  dossierAccess: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=access&shareId=${encodeURIComponent(shareId)}`),
  dossierDocuments: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=documents&shareId=${encodeURIComponent(shareId)}`),
  dossierDocumentUrl: (/** @type {string} */ shareId, /** @type {string} */ fileId) => `/api/citizen/dossier?shareId=${encodeURIComponent(shareId)}&download=${encodeURIComponent(fileId)}`,
  removeDossierDocument: (/** @type {string} */ shareId, /** @type {string} */ fileId) => call('/api/citizen/dossier', { method: 'DELETE', body: { shareId, fileId } }),
  dossierGrants: (/** @type {string} */ shareId) => call('/api/public/dossier-grants', { method: 'POST', body: { shareId, action: 'list' } }),
  // A-17 — the organisations' threads on a dossier the person owns (account session, or the private owner link on the passport page: `ownerSecret`)
  dossierThreads: (/** @type {string} */ shareId, ownerSecret = '') => call('/api/share/thread', { method: 'POST', body: { id: shareId, action: 'list', ...(ownerSecret ? { capability: ownerSecret } : {}) } }),
  dossierThreadMessages: (/** @type {string} */ shareId, /** @type {string} */ threadId, ownerSecret = '') => call('/api/share/thread', { method: 'POST', body: { id: shareId, action: 'messages', threadId, ...(ownerSecret ? { capability: ownerSecret } : {}) } }),
  sendDossierThreadMessage: (/** @type {string} */ shareId, /** @type {string} */ threadId, /** @type {string} */ encryptedContent, ownerSecret = '') => call('/api/share/thread', { method: 'POST', body: { id: shareId, action: 'send', threadId, encryptedContent, ...(ownerSecret ? { capability: ownerSecret } : {}) } }),
  // PKG-2 / C23 — delegation (read-only, scoped, time-limited, revocable)
  listDelegations: () => call('/api/citizen/delegations'),
  inviteDelegate: (/** @type {Record<string, unknown>} */ input) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'invite', ...input } }),
  respondDelegation: (/** @type {string} */ token, /** @type {boolean} */ accept) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'respond', token, accept } }),
  endDelegation: (/** @type {string} */ id) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'end', id } }),
  delegationLog: (/** @type {string} */ id) => call(`/api/citizen/delegations?log=${encodeURIComponent(id)}`),
  delegateView: (/** @type {string} */ id, /** @type {string} */ view) => call(`/api/citizen/delegations?id=${encodeURIComponent(id)}&view=${encodeURIComponent(view)}`),
  // G14-AID — mode accompagnant à distance: a trusted person ASKS, the person confirms (or « agir pour moi » for one part)
  requestDelegateAction: (/** @type {Record<string, unknown>} */ input) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'request-action', ...input } }),
  resolveDelegateRequest: (/** @type {string} */ requestId, /** @type {boolean} */ accept) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'resolve-request', requestId, accept } }),
  setActForMe: (/** @type {Record<string, unknown>} */ input) => call('/api/citizen/delegations', { method: 'POST', body: { action: 'act-for-me', ...input } }),
  delegateRequests: (/** @type {string} */ id) => call(`/api/citizen/delegations?requests=${encodeURIComponent(id)}`),
  // G14-AID — mode accompagnant next to the person (/compte/accompagnement)
  assistOverview: () => call('/api/citizen/assist'),
  startAssist: (/** @type {Record<string, unknown>} */ input) => call('/api/citizen/assist', { method: 'POST', body: { action: 'start', ...input } }),
  endAssist: (/** @type {{ continueAlone?: boolean, password?: string }} */ input = {}) => call('/api/citizen/assist', { method: 'POST', body: { action: 'end', ...input } }),
  endAssistSession: (/** @type {string} */ sid) => call('/api/citizen/assist', { method: 'POST', body: { action: 'end-session', sid } }),
  // PKG-3 / K3 — my appointments: list, cancel, reschedule (D-2), free slots of the same service
  // PKG-4 — referrals proposed by organizations (nothing is shared before 'accept') and the follow-ups of a dossier
  referrals: () => call('/api/citizen/referrals'),
  decideReferral: (/** @type {string} */ id, /** @type {'accept'|'refuse'} */ decision) => call('/api/citizen/referrals', { method: 'POST', body: { id, decision } }),
  // G14-PS — social referrals (non-HDS): claim a one-time code, decide (with the contact to share), withdraw
  socialReferrals: () => call('/api/citizen/social-referrals'),
  socialReferralAction: (/** @type {Record<string, unknown>} */ body) => call('/api/citizen/social-referrals', { method: 'POST', body }),
  dossierFollowUps: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=followups&shareId=${encodeURIComponent(shareId)}`),
  // M2 / G5 — the contact person of the path (« référent de parcours »): declarative, set only with the person's agreement, ended by them at any time
  dossierReferent: (/** @type {string} */ shareId) => call(`/api/citizen/dossier?view=referent&shareId=${encodeURIComponent(shareId)}`),
  decideReferent: (/** @type {string} */ shareId, /** @type {boolean} */ accept) => call('/api/citizen/dossier', { method: 'POST', body: { action: 'referent_decide', shareId, accept } }),
  endReferent: (/** @type {string} */ shareId) => call('/api/citizen/dossier', { method: 'POST', body: { action: 'referent_end', shareId } }),
  myAppointments: () => call('/api/rdv/appointments'),
  cancelAppointment: (/** @type {string} */ id) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  rescheduleAppointment: (/** @type {string} */ id, /** @type {string} */ startAt, /** @type {Record<string, unknown>} */ extra = {}) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/reschedule`, { method: 'POST', body: { startAt, ...extra } }),
  appointmentVisio: (/** @type {string} */ id, /** @type {string} */ action) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/visio`, { method: 'POST', body: { action } }),
  // R43 (E6): the person erases the optional message of their own appointment before it starts
  withdrawAppointmentMessage: (/** @type {string} */ id) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/message/withdraw`, { method: 'POST', body: {} }),
  // R45 (ENG-LR-2): withdraw the explicit art. 9 consent of a sensitive-service booking (an upcoming active appointment is then cancelled)
  withdrawSensitiveConsent: (/** @type {string} */ id) => call(`/api/rdv/appointments/${encodeURIComponent(id)}/sensitive-consent/withdraw`, { method: 'POST', body: {} }),
  bookingServices: (/** @type {string} */ slug) => call(`/api/rdv/structures/${encodeURIComponent(slug)}/services`),
  // A-26: `appointmentId` = the slots THIS appointment can be moved to (the server's own move rules: its professional with team choice, its own slot freed)
  freeSlots: (/** @type {string} */ slug, /** @type {string} */ serviceId, /** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ mode = 'IN_PERSON', /** @type {string} */ appointmentId = '') =>
    call(`/api/rdv/structures/${encodeURIComponent(slug)}/slots?serviceId=${encodeURIComponent(serviceId)}&mode=${encodeURIComponent(mode)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${appointmentId ? `&appointment=${encodeURIComponent(appointmentId)}` : ''}`),
};
