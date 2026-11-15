/**
 * A-25 — one idempotency key per booking ATTEMPT. The server replays a booking made with the same key (POST /api/rdv/appointments answers the existing
 * appointment); the page used to draw a new key on every click, so a lost answer followed by a second click read « this slot was just taken » while the
 * person was booked. The key now belongs to the attempt — structure, service, slot, modality, professional choice — and is kept until the server gives a
 * definitive answer (booked, or a refusal that means nothing was booked). A network failure, a timeout or a server error keeps it: the next click on the
 * same selection replays and shows the confirmed booking. Another selection is another attempt (the server replays whatever the body says).
 * Kept in memory for the page session only (never in storage, never in a URL).
 */

/** @type {{ signature: string, key: string } | null} */
let current = null;

/** @param {{ structureSlug?: unknown, serviceId?: unknown, startAt?: unknown, mode?: unknown, professional?: unknown }} selection @returns {string} */
export function attemptSignature(selection) {
  return JSON.stringify([selection.structureSlug, selection.serviceId, selection.startAt, selection.mode, selection.professional].map((v) => String(v ?? '')));
}

/** the key of this attempt: the one already drawn for the same selection, else a new one @param {string} signature @param {() => string} create @returns {string} */
export function attemptKey(signature, create) {
  if (!current || current.signature !== signature) current = { signature, key: create() };
  return current.key;
}

/** the server answered definitively for this attempt: its key is not reused @param {string} signature */
export function settleAttempt(signature) {
  if (current && current.signature === signature) current = null;
}

/**
 * Whether an HTTP status is a definitive answer about the booking: a success, or a refusal decided by the server before anything was booked. A timeout,
 * a rate limit and every server error are not (the booking may exist): the key is kept and the retry replays.
 * @param {number} status
 */
export function isDefinitiveAnswer(status) {
  if (status >= 200 && status < 300) return true;
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

/** tests only */
export function resetAttempts() { current = null; }
