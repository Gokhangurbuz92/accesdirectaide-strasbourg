/**
 * Restricted public beta (owner directive 29/10/2026), browser side. The server enforces the restriction (api/_utils/public-beta.js);
 * this only explains it: the screens below would need an account, a booking, a document or a form, so they show a French notice instead.
 */
const RESTRICTED = ['/admin', '/pro', '/login', '/auth', '/compte', '/appointments', '/rdv', '/share', '/passport', '/institution', '/r',
  '/contact', '/demande-aide', '/proposer-une-structure', '/orientation', '/diagnostic', '/assistant', '/mon-assistant',
  '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches', '/sentry-test', '/__sentry_test'];

/**
 * R35: the screens of a surface the server opened during the beta (ADA_BETA_OPEN_SURFACES, api/_utils/public-beta.js) are shown when the build names the
 * same surface in VITE_PUBLIC_BETA_OPEN_SURFACES (public, no secret). The server stays the only real protection.
 */
/** @type {Record<string, string[]>} */
export const SCREEN_SURFACES = {
  accounts: ['/login', '/auth', '/compte'], pro: ['/pro'], institution: ['/institution'], appointments: ['/appointments', '/rdv', '/r'],
  communications: ['/contact', '/demande-aide', '/proposer-une-structure'], documents: ['/share', '/passport'],
  diagnostic: ['/diagnostic', '/assistant', '/mon-assistant', '/orientation'], admin: ['/admin', '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches'],
};
const builtOpen = () => {
  let v = '';
  try { v = String(import.meta.env.VITE_PUBLIC_BETA_OPEN_SURFACES || ''); } catch { v = ''; }
  return v.split(',').map((x) => x.trim().toLowerCase()).filter((x) => Object.prototype.hasOwnProperty.call(SCREEN_SURFACES, x));
};

/**
 * R36 (header): the account entry points (« Se connecter », « Créer un compte ») are offered only when accounts can really be used: outside the beta, or
 * when this build opens the accounts surface. @param {boolean} beta @param {string[]} [open]
 */
export function accountEntriesShown(beta, open = builtOpen()) {
  return !beta || open.includes('accounts');
}

/**
 * R43 — the sub-switches of the server (api/_utils/public-beta.js), mirrored for the screens: the build names them in VITE_PUBLIC_BETA_ACCOUNTS_SCOPE
 * (« full »; anything else = the narrow booking scope) and VITE_PUBLIC_BETA_PRO_SELF_REGISTRATION (« open »; anything else = closed).
 * @typedef {{ accountsScope: 'booking' | 'full', proSelfRegistration: boolean }} BetaSubSwitches
 */
/** @returns {BetaSubSwitches} */
const builtSub = () => {
  let scope = ''; let reg = '';
  try { scope = String(import.meta.env.VITE_PUBLIC_BETA_ACCOUNTS_SCOPE || ''); reg = String(import.meta.env.VITE_PUBLIC_BETA_PRO_SELF_REGISTRATION || ''); } catch { scope = ''; reg = ''; }
  return { accountsScope: scope.trim().toLowerCase() === 'full' ? 'full' : 'booking', proSelfRegistration: reg.trim().toLowerCase() === 'open' };
};
/** the account screens of the narrow (booking) scope: sign-in and sign-up, the Mon Espace home, appointments and the account settings (rights) */
export const ACCOUNTS_BOOKING_SCREENS = Object.freeze({ prefixes: ['/login', '/auth', '/compte/rendez-vous', '/compte/parametres'], exact: ['/compte'] });
export const PRO_SELF_REGISTRATION_SCREEN = '/pro/register';

/** @param {string} p normalized path @param {string} x screen prefix */
const under = (p, x) => p === x || p.startsWith(`${x}/`);

/** @param {string} pathname @param {string[]} [open] surfaces opened in this build @param {BetaSubSwitches} [sub] sub-switches of this build */
export function isBetaRestrictedPath(pathname, open = builtOpen(), sub = builtSub()) {
  const p = String(pathname || '/').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  // R43 (E1): the public structure sign-up stays closed while the pro space is open for invited members
  if (under(p, PRO_SELF_REGISTRATION_SCREEN) && !sub.proSelfRegistration) return true;
  const opened = open.flatMap((name) => (name === 'accounts' && sub.accountsScope !== 'full' ? [] : SCREEN_SURFACES[name] || []));
  if (opened.some((x) => under(p, x))) return false;
  // R43 (E2): accounts opened in the narrow scope show only its screens
  if (open.includes('accounts') && sub.accountsScope !== 'full'
    && (ACCOUNTS_BOOKING_SCREENS.exact.includes(p) || ACCOUNTS_BOOKING_SCREENS.prefixes.some((x) => under(p, x)))) return false;
  return RESTRICTED.some((x) => under(p, x));
}

/**
 * The links a beta visitor can follow: a link to a closed screen (assistant, simulator, contact…) is not offered at all, rather than leading to the notice.
 * @template T @param {T[]} links @param {boolean} beta @param {(link: T) => string} pathOf
 */
export function openLinks(links, beta, pathOf) {
  return beta ? links.filter((l) => !isBetaRestrictedPath(pathOf(l))) : links;
}
