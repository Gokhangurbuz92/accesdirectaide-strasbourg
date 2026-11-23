// @ts-check
/**
 * G14-PS — the Passeport Social is a BROWSER-ONLY feature (like the G4 browser-only orientation): no server route, no capability of the API, nothing hosted.
 * It is shown only when the build sets VITE_PASSEPORT_SOCIAL=local (exact value; anything else = the page says it is not open yet). Opening it is an owner
 * decision (privacy notice update; no AIPD of a hosted processing is needed since ADA receives nothing — to be confirmed by counsel).
 * @param {unknown} [value] the build's VITE_PASSEPORT_SOCIAL
 */
export function passeportLocalEnabled(value) {
  let v = value;
  if (v === undefined) { try { v = import.meta.env.VITE_PASSEPORT_SOCIAL; } catch { v = undefined; } }
  return String(v ?? '') === 'local';
}
