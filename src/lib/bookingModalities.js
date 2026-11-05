/**
 * R44 — the modalities of the account booking journey (/rdv/:slug/booking), from the services answer of the API (GET /api/rdv/structures/:slug/services):
 *   - IN_PERSON / VIDEO are bookable only when the service lists them (the server already filters VIDEO out while the video provider is not activated);
 *   - VIDEO the structure announces but the provider does not offer is shown as unavailable, never as bookable;
 *   - a video provider in sandbox (LAB) is said to be a test environment: a mock is never presented as a live service;
 *   - PHONE: the platform has no telephone appointment (no API mode, no slot rule): it is always shown as « not offered online », never bookable.
 * The location is the structure's recorded address only (api/lib/appointment-modes.js locationOf), with its verification state; no address → « to confirm ».
 * Pure functions: nothing here calls the API.
 */

export const BOOKABLE_MODES = Object.freeze(['IN_PERSON', 'VIDEO']);

/**
 * @typedef {{ available?: boolean, sandbox?: boolean, reason?: string } | null | undefined} VideoStatus
 * @typedef {{ address: string, verified: boolean, stepFreeAccess?: boolean } | null | undefined} Location
 * @typedef {{ structure?: { bookingMode?: string, modes?: string[], location?: Location } | null, video?: VideoStatus } | null | undefined} ServicesPayload
 * @typedef {{ mode: 'IN_PERSON' | 'VIDEO' | 'PHONE', bookable: boolean, reason: '' | 'NOT_FOR_SERVICE' | 'VIDEO_NOT_ACTIVE' | 'NOT_OFFERED_ONLINE', sandbox: boolean }} Modality
 */

/** the modes a service can be booked in (an older answer without `modes` = in person, never video) @param {{ modes?: unknown } | null | undefined} service */
export function serviceModes(service) {
  const modes = Array.isArray(service?.modes) ? service.modes.filter((m) => BOOKABLE_MODES.includes(String(m))) : [];
  return modes.length ? modes : ['IN_PERSON'];
}

/** a requested mode (query `?mode=`) when the service offers it, else '' @param {unknown} value @param {{ modes?: unknown } | null | undefined} service */
export function acceptedMode(value, service) {
  const mode = String(value || '').trim().toUpperCase();
  return serviceModes(service).includes(mode) ? mode : '';
}

/**
 * Every modality the journey shows for one service, bookable or not, in a fixed order (in person, video, telephone).
 * @param {ServicesPayload} payload @param {{ modes?: unknown } | null | undefined} service @returns {Modality[]}
 */
export function modalityOptions(payload, service) {
  const offered = serviceModes(service);
  const video = payload?.video || null;
  const announced = ['VIDEO', 'BOTH'].includes(String(payload?.structure?.bookingMode || ''));
  /** @type {Modality[]} */
  const out = [];
  out.push({ mode: 'IN_PERSON', bookable: offered.includes('IN_PERSON'), reason: offered.includes('IN_PERSON') ? '' : 'NOT_FOR_SERVICE', sandbox: false });
  if (offered.includes('VIDEO')) out.push({ mode: 'VIDEO', bookable: true, reason: '', sandbox: Boolean(video?.sandbox) });
  else if (announced && !video?.available) out.push({ mode: 'VIDEO', bookable: false, reason: 'VIDEO_NOT_ACTIVE', sandbox: false });
  else out.push({ mode: 'VIDEO', bookable: false, reason: 'NOT_FOR_SERVICE', sandbox: false });
  out.push({ mode: 'PHONE', bookable: false, reason: 'NOT_OFFERED_ONLINE', sandbox: false });
  return out;
}

/** the location to show before the commitment: the recorded address, or null (the page then says « to confirm with the structure ») @param {ServicesPayload} payload @returns {Location} */
export function bookingLocation(payload) {
  const loc = payload?.structure?.location;
  if (!loc || typeof loc.address !== 'string' || !loc.address.trim()) return null;
  return { address: loc.address.trim(), verified: loc.verified === true, stepFreeAccess: loc.stepFreeAccess === true };
}

/**
 * What a refused booking (POST /api/rdv/appointments) means for the journey. The server codes are the contract; « Slot no longer available » (409 without a
 * code) is a slot taken meanwhile.
 * @param {number} status @param {{ code?: unknown, error?: unknown } | null | undefined} body
 * @returns {'AUTH' | 'EMAIL_NOT_VERIFIED' | 'AGE_DECLARATION' | 'MINOR' | 'PROFESSIONAL' | 'MESSAGE_CONSENT' | 'VIDEO_CONSENT' | 'MODE' | 'SLOT_TAKEN' | 'CONTACT_STRUCTURE' | 'SENSITIVE_CONSENT' | 'OTHER'}
 */
export function bookingRefusal(status, body) {
  const code = String(body?.code || '');
  if (status === 401) return 'AUTH';
  if (code === 'EMAIL_NOT_VERIFIED') return 'EMAIL_NOT_VERIFIED';
  if (code === 'AGE_DECLARATION_REQUIRED') return 'AGE_DECLARATION';
  if (code === 'ADULT_ACCOUNT_REQUIRED') return 'MINOR';
  if (code === 'PROFESSIONAL_UNAVAILABLE') return 'PROFESSIONAL';
  if (code === 'MESSAGE_CONSENT_REQUIRED') return 'MESSAGE_CONSENT';
  if (code === 'VIDEO_CONSENT_REQUIRED') return 'VIDEO_CONSENT';
  if (code === 'MODE_UNAVAILABLE') return 'MODE';
  // R45 (ENG-LR-2): the service is not bookable online (art. 9 gate closed / not reviewed): the person is pointed to the structure; the separate art. 9 box
  if (code === 'SENSITIVE_BOOKING_NOT_OPEN' || code === 'SERVICE_SENSITIVITY_UNREVIEWED') return 'CONTACT_STRUCTURE';
  if (code === 'SENSITIVE_CONSENT_REQUIRED') return 'SENSITIVE_CONSENT';
  if (status === 409) return 'SLOT_TAKEN';
  return 'OTHER';
}

/**
 * The booking context kept through a new sign-in (the gate's own `citizenBookingLoginUrl` keeps the query of a /rdv/<slug>/booking path): the chosen service
 * and modality only — never the slot, the message or the professional.
 * @param {string} search the current query @param {{ serviceId?: unknown, mode?: unknown }} ctx @returns {string} a query string starting with « ? », or ''
 */
export function bookingContextQuery(search, ctx) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  q.delete('appointment');
  q.delete('token');
  const serviceId = String(ctx.serviceId || '');
  if (/^[A-Za-z0-9_-]{1,128}$/.test(serviceId)) q.set('serviceId', serviceId); else q.delete('serviceId');
  const mode = String(ctx.mode || '');
  if (BOOKABLE_MODES.includes(mode)) q.set('mode', mode); else q.delete('mode');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** the modality names in the interface language @param {(key: string, fallback: string) => string} t @returns {Record<string, string>} */
export const modalityLabels = (t) => ({ IN_PERSON: t('booking:modality.in_person', 'Sur place, à la structure'), VIDEO: t('booking:modality.video', 'À distance, en visio'), PHONE: t('booking:modality.phone', 'Par téléphone') });
