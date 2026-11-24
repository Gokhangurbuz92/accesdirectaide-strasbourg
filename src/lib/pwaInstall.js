// @ts-check
/**
 * 24/11/2026 (owner: « let people add the web app to the home screen on iOS, Android and PC, on every screen ») — the install state of the browser.
 * Chrome / Edge / Samsung Internet (Android, Windows, macOS, Linux, ChromeOS) fire `beforeinstallprompt`: it is kept here as early as possible (this module
 * is imported by src/main.jsx) and replayed by `promptInstall()` from a click — never automatically. Safari (iPhone / iPad / Mac) and Firefox have no such
 * event: the card shows the steps of their own menu instead. Nothing is sent anywhere; « dismissed » is a device-only preference (localStorage).
 */

/** @type {any} */
let deferred = null;
/** @type {Set<() => void>} */
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

/** @param {() => void} fn @returns {() => void} */
export function onInstallChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** opened as an installed app (home-screen icon, dock, start menu) */
export function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true; } catch { return false; }
}

/**
 * which install path this browser has
 * @param {Navigator} [nav]
 * @returns {'installed' | 'prompt' | 'ios' | 'mac-safari' | 'android-other' | 'firefox' | 'other'}
 */
export function installKind(nav = typeof navigator !== 'undefined' ? navigator : /** @type {any} */ ({})) {
  if (typeof window !== 'undefined' && isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  const ua = nav.userAgent || '';
  const appleMobile = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  if (appleMobile) return 'ios';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'mac-safari';
  if (/Android/.test(ua)) return 'android-other';
  return 'other';
}

/** shows the browser's own install dialog (Chrome / Edge); must run from a click @returns {Promise<'accepted' | 'dismissed' | 'unavailable'>} */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const e = deferred; deferred = null; notify();
  try { await e.prompt(); const choice = await e.userChoice; return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed'; } catch { return 'unavailable'; }
}

export const INSTALL_DISMISS_KEY = 'ada_install_dismissed';
/** the floating suggestion was closed on this device (shown again after 60 days) */
export function installDismissed() {
  try { const at = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0); return at > 0 && Date.now() - at < 60 * 24 * 3600 * 1000; } catch { return false; }
}
export function dismissInstall() { try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch { /* private browsing */ } }
