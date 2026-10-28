/**
 * PKG-11 / C21 · C22 — the person's objection to audience measurement (Vercel Web Analytics / Speed Insights), self-service and kept on THIS device only: nothing
 * is sent (an objection must not itself be measured). Read at start (the measurement scripts are then not loaded at all) and before every event (an objection
 * made during the visit stops the events at once). Before: « écrivez-nous » was the only way to object.
 */
export const AUDIENCE_OBJECTION_KEY = 'ada_audience_objection';

export function hasObjectedToAudience() {
  try { return globalThis.localStorage?.getItem(AUDIENCE_OBJECTION_KEY) === 'yes'; } catch { return false; }
}

/** @param {boolean} objected @returns {boolean} false when the browser refused to keep the choice */
export function setAudienceObjection(objected) {
  try {
    if (objected) globalThis.localStorage.setItem(AUDIENCE_OBJECTION_KEY, 'yes'); else globalThis.localStorage.removeItem(AUDIENCE_OBJECTION_KEY);
    return true;
  } catch { return false; }
}

/** pages whose address itself is a capability or names a person's record: the segment after the prefix is never measured */
const PRIVATE_PATH = /^\/(share|passport|appointments\/(cancel|reschedule)|r|compte\/[a-z-]+|pro\/[a-z-]+|admin\/[a-z-]+|institution\/[a-z-]+)\/[^/]+/;
/** an identifier-looking segment (uuid, token, long id) */
const ID_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * R12 / A18: the address measured is the PAGE, never a secret: no query string, no fragment (invitation ?token=, ?mfa…), the segment after a private prefix
 * and any identifier-looking segment replaced by « :id ». @param {string} url
 */
export function measuredUrl(url) {
  let u; try { u = new URL(String(url), 'https://local.invalid'); } catch { return null; }
  let path = u.pathname.replace(PRIVATE_PATH, (m) => `${m.slice(0, m.lastIndexOf('/'))}/:id`);
  // the public record pages keep their slug (public by nature); elsewhere an identifier-looking segment is replaced
  if (!/^\/(aides|demarches|dispositifs|structures|annuaire|guides|outils)\//.test(path)) path = path.split('/').map((seg) => (ID_SEGMENT.test(seg) ? ':id' : seg)).join('/');
  return u.origin === 'https://local.invalid' ? path : `${u.origin}${path}`;
}
/** beforeSend middleware of both Vercel components: an event is dropped (null) once the person has objected; otherwise its address is reduced (measuredUrl) */
export const dropIfObjected = (/** @type {any} */ event) => {
  if (hasObjectedToAudience()) return null;
  if (!event || typeof event !== 'object' || !event.url) return event;
  const url = measuredUrl(event.url);
  return url ? { ...event, url } : null;
};
