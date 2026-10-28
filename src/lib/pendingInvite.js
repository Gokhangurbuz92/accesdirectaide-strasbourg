/**
 * An organization invitation lives in the URL FRAGMENT (`/pro/dossier/:id#invite=...`): fragments are never sent to a server, but a login redirect drops them.
 * Keep it for THIS tab only (sessionStorage; 30 minutes; removed when used) so a professional who has to log in first still lands on the invitation.
 */
const KEY = 'ada_pending_invite';
const MAX_AGE_MS = 30 * 60 * 1000;

/** @param {{ pathname: string, hash: string }} location */
export function rememberPendingInvite(location) {
  try {
    if (location.pathname.startsWith('/pro/dossier/') && /^#(invite|token)=/.test(location.hash)) {
      window.sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, hash: location.hash, at: Date.now() }));
    }
  } catch {
    // storage unavailable: the professional simply reopens the invitation link after login
  }
}

/** The pending path to resume after login, or null. Does not consume the invitation (the dossier page does). */
export function pendingInvitePath() {
  try {
    const p = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    if (p && typeof p.path === 'string' && Date.now() - p.at < MAX_AGE_MS) return p.path;
  } catch {
    // ignore
  }
  return null;
}

/** Consumes the pending invitation for `pathname` (single use) and returns its fragment, or ''. @param {string} pathname */
export function takePendingInvite(pathname) {
  try {
    const p = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    window.sessionStorage.removeItem(KEY);
    if (p && p.path === pathname && Date.now() - p.at < MAX_AGE_MS) return String(p.hash || '');
  } catch {
    // ignore
  }
  return '';
}
