/**
 * RC5: the OWNER secret of a shared dossier (destructive / management rights). It is returned once by POST /api/share/create and is NOT part of the recipient link.
 * Kept (a) in the private passport link `/passport/:id#owner=...` (fragment: never sent to a server, scrubbed from the address bar) and (b) in this browser's localStorage per dossier
 * together with the dossier's expiry: expired entries are purged on every read/write and the entry is deleted after revocation.
 * Residual risk (documented): localStorage is readable by any script running on this origin (XSS); the CSP restricts script sources to 'self' + the analytics host.
 */
const PREFIX = 'ada_share_owner_';
/** @param {string} id */
const KEY = (id) => `${PREFIX}${id}`;
export const OWNER_HEADER = 'X-Share-Owner-Secret';

/** Remove every stored owner secret whose dossier has expired (the server refuses them anyway; no reason to keep a credential). */
export function purgeExpiredOwnerSecrets() {
  try {
    const now = Date.now();
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const v = JSON.parse(window.localStorage.getItem(k) || 'null');
        if (!v || typeof v.s !== 'string' || (v.exp && now > v.exp)) window.localStorage.removeItem(k);
      } catch {
        window.localStorage.removeItem(k);        // unparseable entry: drop
      }
    }
  } catch {
    // storage unavailable
  }
}

/**
 * @param {string} id
 * @param {string} secret
 * @param {string | number | Date | null} [expiresAt] dossier expiry (ISO string / ms / Date) returned by share/create
 */
export function rememberOwnerSecret(id, secret, expiresAt = null) {
  try {
    if (!id || !secret) return;
    const exp = expiresAt ? new Date(expiresAt).getTime() : 0;
    window.localStorage.setItem(KEY(id), JSON.stringify({ s: secret, exp: Number.isFinite(exp) ? exp : 0 }));
    purgeExpiredOwnerSecrets();
  } catch {
    // storage unavailable: the private passport link still carries the secret
  }
}

/**
 * Reads (and scrubs) `#owner=` from the URL, else falls back to the value remembered in this browser (unless expired).
 * @param {string} id
 */
export function resolveOwnerSecret(id) {
  let fromHash = '';
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    fromHash = params.get('owner') || '';
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  } catch {
    // ignore
  }
  if (fromHash) {
    rememberOwnerSecret(id, fromHash);
    return fromHash;
  }
  purgeExpiredOwnerSecrets();
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY(id)) || 'null');
    return v && typeof v.s === 'string' ? v.s : '';
  } catch {
    return '';
  }
}

/** @param {string} id */
export function forgetOwnerSecret(id) {
  try {
    window.localStorage.removeItem(KEY(id));
  } catch {
    // ignore
  }
}
