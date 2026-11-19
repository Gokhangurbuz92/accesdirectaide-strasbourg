/**
 * Restricted public beta (owner directive 29/10/2026), browser side. The server enforces the restriction (api/_utils/public-beta.js);
 * this only explains it: the screens below would need an account, a booking, a document or a form, so they show a French notice instead.
 */
const RESTRICTED = ['/admin', '/pro', '/login', '/auth', '/compte', '/appointments', '/rdv', '/share', '/passport', '/institution', '/r',
  '/contact', '/demande-aide', '/proposer-une-structure', '/orientation', '/diagnostic', '/assistant', '/mon-assistant',
  '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches', '/sentry-test', '/__sentry_test',
  // X04 (expansion): academy pages and events, the person's registrations and their administration — surface « events », opened by no build
  '/academie', '/evenements', '/compte/evenements', '/admin/academie-evenements',
  // X02 (expansion): testimonials, the person's own testimonials and their moderation — surface « testimonials », opened by no build
  '/temoignages', '/compte/temoignages', '/admin/temoignages',
  // X01 (expansion): community stories, the person's pseudonym and stories and their moderation — surface « stories », opened by no build
  '/histoires', '/compte/histoires', '/admin/histoires',
  // X05 (expansion): the job board, an employer's listings and their moderation — surface « employment », opened by no build
  '/offres-emploi', '/pro/offres-emploi', '/admin/offres-emploi'];

/**
 * R35: the screens of a surface the server opened during the beta (ADA_BETA_OPEN_SURFACES, api/_utils/public-beta.js) are shown when the build names the
 * same surface in VITE_PUBLIC_BETA_OPEN_SURFACES (public, no secret). The server stays the only real protection.
 */
/** @type {Record<string, string[]>} */
export const SCREEN_SURFACES = {
  accounts: ['/login', '/auth', '/compte'], pro: ['/pro'], institution: ['/institution'], appointments: ['/appointments', '/rdv', '/r'],
  communications: ['/contact', '/demande-aide', '/proposer-une-structure'], documents: ['/share', '/passport'],
  diagnostic: ['/diagnostic', '/assistant', '/mon-assistant', '/orientation'], admin: ['/admin', '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches'],
  events: ['/academie', '/evenements', '/compte/evenements', '/admin/academie-evenements'],
  testimonials: ['/temoignages', '/compte/temoignages', '/admin/temoignages'],
  stories: ['/histoires', '/compte/histoires', '/admin/histoires'],
  employment: ['/offres-emploi', '/pro/offres-emploi', '/admin/offres-emploi'],
};
const builtOpen = () => {
  let v = '';
  try { v = String(import.meta.env.VITE_PUBLIC_BETA_OPEN_SURFACES || ''); } catch { v = ''; }
  return v.split(',').map((x) => x.trim().toLowerCase()).filter((x) => Object.prototype.hasOwnProperty.call(SCREEN_SURFACES, x));
};

/**
 * R47: does this build open a surface that the beta banner says is closed (accounts, appointments, documents)? Then the banner must not say « not open yet ».
 * @param {string[]} [open]
 */
export function personalSurfacesOpened(open = builtOpen()) {
  return open.some((x) => x === 'accounts' || x === 'appointments' || x === 'documents');
}

/** V2 (security review D3): this build opens the personal accounts — the beta notices then describe them instead of saying « not open ». @param {string[]} [open] */
export function accountsOpened(open = builtOpen()) {
  return open.includes('accounts');
}

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
  // X04: the events screens follow ONLY the « events » surface — they sit under /compte and /admin, whose openings must not open them
  if (SCREEN_SURFACES.events.some((x) => under(p, x))) return !open.includes('events');
  // X02: the testimonial screens follow ONLY the « testimonials » surface, for the same reason
  if (SCREEN_SURFACES.testimonials.some((x) => under(p, x))) return !open.includes('testimonials');
  // X01: the community story screens follow ONLY the « stories » surface, for the same reason
  if (SCREEN_SURFACES.stories.some((x) => under(p, x))) return !open.includes('stories');
  // X05: the job board screens follow ONLY the « employment » surface (the employer screen sits under /pro but « pro » does not open it)
  if (SCREEN_SURFACES.employment.some((x) => under(p, x))) return !open.includes('employment');
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
 * VIS-R — is Mon Parcours usable in this build: outside the beta, or when the build opens the accounts surface in its full scope (the server gate is
 * api/_utils/public-beta.js: `citizen/parcours` is outside the narrow booking scope). « Ajouter à mon parcours » is offered only then.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function parcoursOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/compte/parcours', open, sub);
}

/**
 * A-8 — can an appointment be asked online in this build: outside the beta, or when the build opens the appointments surface (the booking screens live
 * under /rdv). A place whose record says « online booking » is offered « Voir les créneaux » only then; otherwise the page shows its contact channels.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function bookingOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/rdv', open, sub);
}

/**
 * G3 — can a dossier be shared (POST /api/share/create) in this build: outside the beta, or when the build opens the documents surface (the server keeps
 * `share` closed with it). The diagnostic's « Partager le dossier » is offered only then; the PDF download is local and stays.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function shareOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/share', open, sub);
}

/**
 * The links a beta visitor can follow: a link to a closed screen (assistant, simulator, contact…) is not offered at all, rather than leading to the notice.
 * @template T @param {T[]} links @param {boolean} beta @param {(link: T) => string} pathOf
 */
export function openLinks(links, beta, pathOf) {
  return beta ? links.filter((l) => !isBetaRestrictedPath(pathOf(l))) : links;
}

/**
 * X04 (expansion) — are the academy and event screens usable in this build: outside the beta, or when the build opens the « events » surface. Links to
 * them (Mon Espace, the administration menu) are offered only then; the server keeps the capability « community.events » closed anyway.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function eventsOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/evenements', open, sub);
}

/**
 * X02 (expansion) — are the testimonial screens usable in this build: outside the beta, or when the build opens the « testimonials » surface. Links to them
 * (the administration menu) are offered only then; the server keeps the capability « community.testimonials » closed anyway.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function testimonialsOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/temoignages', open, sub);
}

/**
 * X01 (expansion) — are the community story screens usable in this build: outside the beta, or when the build opens the « stories » surface. Links to them
 * (the administration menu) are offered only then; the server keeps the capability « community.stories » closed anyway.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function storiesOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/histoires', open, sub);
}

/**
 * X05 (expansion) — are the job board screens usable in this build: outside the beta, or when the build opens the « employment » surface. Links to them
 * (the administration menu) are offered only then; the server keeps the capability « community.employment » closed anyway.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function employmentOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/offres-emploi', open, sub);
}
