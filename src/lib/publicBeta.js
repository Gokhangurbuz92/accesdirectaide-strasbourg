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
  '/offres-emploi', '/pro/offres-emploi', '/admin/offres-emploi',
  // X03 (expansion): Entraide, the member side and its moderation — surface « entraide », opened by no build (dedicated AIPD first)
  '/compte/entraide', '/admin/entraide',
  // G14: the account-free notice form (DSA art. 16) and « my moderation decisions » — surface « notices », opened by no build
  '/signaler-un-contenu', '/compte/moderation',
  // G14-PS: the social referral (non-HDS), both sides — surface « social_referrals », opened by no build
  '/compte/orientations-sociales', '/pro/orientations-sociales'];

/**
 * R35: the screens of a surface the server opened during the beta (ADA_BETA_OPEN_SURFACES, api/_utils/public-beta.js) are shown when the build names the
 * same surface in VITE_PUBLIC_BETA_OPEN_SURFACES (public, no secret). The server stays the only real protection.
 */
/** @type {Record<string, string[]>} */
export const SCREEN_SURFACES = {
  accounts: ['/login', '/auth', '/compte'], pro: ['/pro'], institution: ['/institution'], appointments: ['/appointments', '/rdv', '/r'],
  // R4 fix (owner report 24/11): the citizen screens of these surfaces sit under /compte, which the narrow accounts scope does not open — they follow their
  // own surface like the server does (api/_utils/public-beta.js: « messages » in communications; « citizen/coffre », « citizen/dossier » in documents).
  communications: ['/contact', '/demande-aide', '/proposer-une-structure', '/compte/messages'],
  documents: ['/share', '/passport', '/compte/dossiers-chiffres', '/pro/partages-chiffres', '/compte/coffre', '/compte/partages'],
  diagnostic: ['/diagnostic', '/assistant', '/mon-assistant', '/orientation'], admin: ['/admin', '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches'],
  events: ['/academie', '/evenements', '/compte/evenements', '/admin/academie-evenements'],
  testimonials: ['/temoignages', '/compte/temoignages', '/admin/temoignages'],
  stories: ['/histoires', '/compte/histoires', '/admin/histoires'],
  employment: ['/offres-emploi', '/pro/offres-emploi', '/admin/offres-emploi'],
  entraide: ['/compte/entraide', '/admin/entraide'],
  notices: ['/signaler-un-contenu', '/compte/moderation'],
  // G14-AI: the floating assistant widget (no screen of its own: POST /api/assistant/chat, server surface « assistant », capability ai.citizen_assistant)
  assistant: [],
  social_referrals: ['/compte/orientations-sociales', '/pro/orientations-sociales'],
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
 * G4: VITE_PUBLIC_BETA_ACCOUNTS_EXTRA names the modules added to the narrow scope (same exact names as ADA_BETA_ACCOUNTS_EXTRA; unknown = nothing).
 * @typedef {{ accountsScope: 'booking' | 'full', proSelfRegistration: boolean, accountsExtras?: string[] }} BetaSubSwitches
 */
/** G4: the screens of each module that can be added by name to the narrow accounts scope (server: ACCOUNTS_EXTRAS) @type {Readonly<Record<string, readonly string[]>>} */
export const ACCOUNTS_EXTRA_SCREENS = Object.freeze({ parcours: Object.freeze(['/compte/parcours']), assist: Object.freeze(['/compte/accompagnement']),   // G14-AID: mode accompagnant
  // G14-R3: « Mon foyer » and the guardian card live on /compte/profil (already a narrow-scope screen): no screen of their own; the trusted persons have theirs
  household: Object.freeze([]), guardians: Object.freeze([]), delegations: Object.freeze(['/compte/delegations']),
  // G14-R3G: the representative of a protected adult and the protected person
  legal_protection: Object.freeze(['/compte/protection-juridique']),
  // TG: the optional Telegram card lives on /compte/profil (already a narrow-scope screen)
  telegram: Object.freeze([]) });
/** @param {unknown} v @returns {string[]} */
const extrasOf = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => Object.prototype.hasOwnProperty.call(ACCOUNTS_EXTRA_SCREENS, x));
/** @returns {BetaSubSwitches} */
const builtSub = () => {
  let scope = ''; let reg = ''; let extra = '';
  try {
    scope = String(import.meta.env.VITE_PUBLIC_BETA_ACCOUNTS_SCOPE || ''); reg = String(import.meta.env.VITE_PUBLIC_BETA_PRO_SELF_REGISTRATION || '');
    extra = String(import.meta.env.VITE_PUBLIC_BETA_ACCOUNTS_EXTRA || '');
  } catch { scope = ''; reg = ''; extra = ''; }
  return { accountsScope: scope.trim().toLowerCase() === 'full' ? 'full' : 'booking', proSelfRegistration: reg.trim().toLowerCase() === 'open', accountsExtras: extrasOf(extra) };
};
/** the account screens of the narrow (booking) scope: sign-in and sign-up, the Mon Espace home, appointments and the account settings (rights) */
// G14 (local citizen acceptance 22/11): /compte/profil holds the profile, the account language (C04) and the e-mail preferences (C20/N01), which the server
// already serves in the narrow scope (citizen/profile, citizen/preferences: api/_utils/public-beta.js ACCOUNTS_BOOKING_SCOPE) — it was missing here, so the
// settings links led to the closed page.
// 24/11/2026: « Guide d’utilisation » (/compte/guide) is static help (no server call): it opens with the accounts, in every scope
export const ACCOUNTS_BOOKING_SCREENS = Object.freeze({ prefixes: ['/login', '/auth', '/compte/rendez-vous', '/compte/parametres', '/compte/profil', '/compte/guide'], exact: ['/compte'] });
export const PRO_SELF_REGISTRATION_SCREEN = '/pro/register';

/** @param {string} p normalized path @param {string} x screen prefix */
const under = (p, x) => p === x || p.startsWith(`${x}/`);

/**
 * G4 — the browser-only orientation (src/lib/orientationBrowserOnly.js, VITE_ORIENTATION_BROWSER_ONLY=1 exactly): /orientation then runs entirely in the
 * browser and never calls /api/diagnostic, so it is not a closed screen. /diagnostic and the server surface `diagnostic` are unchanged.
 */
export const BROWSER_ONLY_SCREEN = '/orientation';
const builtBrowserOnly = () => {
  let v = '';
  try { v = String(import.meta.env.VITE_ORIENTATION_BROWSER_ONLY ?? ''); } catch { v = ''; }
  return v === '1';
};

/** @param {string} pathname @param {string[]} [open] surfaces opened in this build @param {BetaSubSwitches} [sub] sub-switches of this build @param {boolean} [browserOnly] G4 flag of this build */
export function isBetaRestrictedPath(pathname, open = builtOpen(), sub = builtSub(), browserOnly = builtBrowserOnly()) {
  const p = String(pathname || '/').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (browserOnly && under(p, BROWSER_ONLY_SCREEN)) return false;
  if (p === '/pro/guide-public') return false;   // Guide ADA Pro, public version: a static explanation for structures before they register (no account, no API)
  // X04: the events screens follow ONLY the « events » surface — they sit under /compte and /admin, whose openings must not open them
  if (SCREEN_SURFACES.events.some((x) => under(p, x))) return !open.includes('events');
  // X02: the testimonial screens follow ONLY the « testimonials » surface, for the same reason
  if (SCREEN_SURFACES.testimonials.some((x) => under(p, x))) return !open.includes('testimonials');
  // X01: the community story screens follow ONLY the « stories » surface, for the same reason
  if (SCREEN_SURFACES.stories.some((x) => under(p, x))) return !open.includes('stories');
  // X05: the job board screens follow ONLY the « employment » surface (the employer screen sits under /pro but « pro » does not open it)
  if (SCREEN_SURFACES.employment.some((x) => under(p, x))) return !open.includes('employment');
  // X03: the Entraide screens follow ONLY the « entraide » surface (they sit under /compte and /admin, which do not open them)
  if (SCREEN_SURFACES.entraide.some((x) => under(p, x))) return !open.includes('entraide');
  // G14: the notice form and « my moderation decisions » follow ONLY the « notices » surface (/compte/moderation sits under /compte, which does not open it)
  if (SCREEN_SURFACES.notices.some((x) => under(p, x))) return !open.includes('notices');
  // G14-PS: the social referral screens follow ONLY the « social_referrals » surface (they sit under /compte and /pro, which do not open them)
  if (SCREEN_SURFACES.social_referrals.some((x) => under(p, x))) return !open.includes('social_referrals');
  // R43 (E1): the public structure sign-up stays closed while the pro space is open for invited members
  if (under(p, PRO_SELF_REGISTRATION_SCREEN) && !sub.proSelfRegistration) return true;
  const opened = open.flatMap((name) => (name === 'accounts' && sub.accountsScope !== 'full' ? [] : SCREEN_SURFACES[name] || []));
  if (opened.some((x) => under(p, x))) return false;
  // R43 (E2): accounts opened in the narrow scope show only its screens
  if (open.includes('accounts') && sub.accountsScope !== 'full'
    && (ACCOUNTS_BOOKING_SCREENS.exact.includes(p) || ACCOUNTS_BOOKING_SCREENS.prefixes.some((x) => under(p, x)))) return false;
  // G4: a module added by name to the narrow scope (e.g. Mon Parcours) shows its own screens, and only those
  if (open.includes('accounts') && sub.accountsScope !== 'full'
    && extrasOf((sub.accountsExtras || []).join(',')).some((name) => ACCOUNTS_EXTRA_SCREENS[name].some((x) => under(p, x)))) return false;
  return RESTRICTED.some((x) => under(p, x));
}

/**
 * VIS-R — is Mon Parcours usable in this build: outside the beta, or when the build opens the accounts surface in its full scope (the server gate is
 * api/_utils/public-beta.js: `citizen/parcours` is outside the narrow booking scope) or adds « parcours » to the narrow scope (G4). « Ajouter à mon
 * parcours » is offered only then.
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
 * G14-AI — is the citizen assistant widget shown in this build: outside the beta, or when the build names « assistant » in VITE_PUBLIC_BETA_OPEN_SURFACES
 * (mirror of ADA_BETA_OPEN_SURFACES=assistant). The server still needs the capability ai.citizen_assistant in ADA_CAPABILITIES_OPEN.
 * @param {boolean} beta @param {string[]} [open]
 */
export function assistantOpened(beta, open = builtOpen()) {
  return !beta || open.includes('assistant');
}

/**
 * The links a beta visitor can follow: a link to a closed screen (assistant, simulator, contact…) is not offered at all, rather than leading to the notice.
 * @template T @param {T[]} links @param {boolean} beta @param {(link: T) => string} pathOf
 */
export function openLinks(links, beta, pathOf) {
  return beta ? links.filter((l) => !isBetaRestrictedPath(pathOf(l))) : links;
}

/**
 * G8 — the public indicators section of /impact (src/components/impact/PublicIndicators.jsx) is shown only when the build sets VITE_PUBLIC_INDICATORS=open
 * (exact value; anything else = hidden). The server answers only under ADA_PUBLIC_INDICATORS=open (api/lib/public-indicators.js): both stay closed by default.
 * @param {unknown} [value]
 */
export function publicIndicatorsOpened(value = undefined) {
  let v = value;
  if (v === undefined) { try { v = import.meta.env.VITE_PUBLIC_INDICATORS; } catch { v = ''; } }
  return String(v ?? '').trim().toLowerCase() === 'open';
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

/**
 * X03 (expansion) — are the Entraide screens usable in this build: outside the beta, or when the build opens the « entraide » surface. Links to them (the
 * administration menu) are offered only then; the server keeps the capability « community.entraide » closed anyway (dedicated AIPD first).
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function entraideOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/compte/entraide', open, sub);
}

/**
 * G14 — is the account-free notice form usable in this build: outside the beta, or when the build opens the « notices » surface. Links to it are offered
 * only then; the server answers 503 anyway while no content capability is open.
 * @param {boolean} beta @param {string[]} [open] @param {BetaSubSwitches} [sub]
 */
export function noticesOpened(beta, open = builtOpen(), sub = builtSub()) {
  return !beta || !isBetaRestrictedPath('/signaler-un-contenu', open, sub);
}
