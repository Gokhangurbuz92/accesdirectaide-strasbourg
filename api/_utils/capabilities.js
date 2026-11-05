/**
 * R45 / ENG-LR-6 — capability registry and server-side capability gates (CONTROL/r45/R45_CAPABILITY_GATES_EN.md).
 *
 * The AIPD (CONTROL/r44/R44_AIPD_VERSION_REVUE_FINALE_FR.md § 2.1, condition C-PER, measure P-7) covers, for the first opening only: sign-up,
 * authentication, appointment search and booking, the optional message, assignment, notifications, Outlook busy/free, audit, rights, logs and
 * backups, purge. Everything else stays CLOSED until the AIPD is extended — and, for a capability that may host health data, until certified
 * health-data hosting (HDS) exists. Closed is not removed: every handler stays in the code and in the 173-feature scope.
 *
 * Opening rule (fail-closed, exact names, no wildcard):
 *   in-AIPD capability   open when its surface is open (during the restricted beta: ADA_BETA_OPEN_SURFACES; outside the beta: always)
 *   out-of-AIPD          ALSO needs ADA_CAPABILITIES_OPEN to name it (comma list; an unknown name opens nothing)
 *   requiresHds          ALSO needs ADA_HDS_CERTIFIED_HOSTING to hold a well-formed, unexpired attestation token (HDS_TOKEN_FORMAT below)
 *   openable: false      never opens (no switch)
 *
 * Enforcement (lead decision R45, binding): ON when the restricted beta is on, OR VERCEL_ENV is production / preview, OR ADA_CAPABILITY_ENFORCEMENT=1.
 * It is OFF only in development / test without any of these (the LAB runs the full product). No value turns it off in production or preview.
 *
 * `requiresHds` follows the HDS feature matrix (CONTROL/r45/R45_HDS_FEATURE_MATRIX_FR.md § 3, [PROPOSITION] [REVUE JURIDIQUE]): HDS applicability depends on
 * where the data come from and on whose behalf they are hosted; the ANS reads « suivi social et médico-social » as the follow-up of an ESSMS (CASF L312-1).
 * Vault = HDS (the ANS example); shared dossiers and referrals probable; ProCase notes yes for an ESSMS (`hdsDependsOnStructure`: HDS is waived only for a
 * structure positively classified NOT_ESSMS — an unknown category fails closed, and no reviewed classification table exists yet, matrix § 5.5 step 1);
 * saved diagnostic uncertain, leaning no (it stays closed anyway: outside the AIPD). There is no platform-wide « HDS everything » switch. A token is a
 * statement recorded by the controller that a certificate exists, not a verification of it.
 */
import { accountsScope, isPublicBetaRestricted, openSurfaces } from './public-beta.js';

export const CAPABILITY_NOT_OPEN = 'CAPABILITY_NOT_OPEN';
export const CAPABILITY_NOT_OPEN_MESSAGE = 'Cette fonction n’est pas encore ouverte : elle sera disponible lorsque son analyse d’impact sur la protection des données '
  + '(et, si nécessaire, un hébergement certifié des données de santé) sera en place. Aucune donnée n’a été lue ni enregistrée.';

const M = 'R45_HDS_FEATURE_MATRIX_FR.md § 3';

/**
 * @typedef {{ description: string, aipd: 'in' | 'out', requiresHds: boolean, hdsDependsOnStructure?: boolean, hdsNote?: string, surface: string, accountsFull?: boolean,
 *   openable?: boolean, aipdRef: string }} Capability
 */
/** @type {Readonly<Record<string, Capability>>} */
export const CAPABILITIES = Object.freeze({
  // ── inside the AIPD (first opening)
  'citizen.account': { description: 'citizen sign-up, sign-in, verification, password, sign-out, deletion, export, profile, adult statement, contact rectification, e-mail preferences, restriction, Mon Espace summary',
    aipd: 'in', requiresHds: false, surface: 'accounts', aipdRef: 'P2 P3 P13' },
  'citizen.booking': { description: 'appointment search, booking, rescheduling, cancellation, the person’s own appointments', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P4 P5' },
  'citizen.booking_message': { description: 'the optional short message of a booking and the message state of the account', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P6' },
  'citizen.push': { description: 'Web Push notifications on the person’s device (C-PER: part of the full accounts scope)', aipd: 'in', requiresHds: false, surface: 'accounts', accountsFull: true, aipdRef: 'P10' },
  'pro.account': { description: 'professional sign-in, MFA (invitation-bound), profile, notifications, own audit trail', aipd: 'in', requiresHds: false, surface: 'pro', aipdRef: 'P3 P10 P12' },
  'pro.structure_admin': { description: 'team, invitations, structure record, aggregate statistics of the structure', aipd: 'in', requiresHds: false, surface: 'pro', aipdRef: 'P7 P12' },
  'pro.agenda': { description: 'opening hours, slots, time off, booking settings, services, the structure’s appointments and their assignment', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P5 P7' },
  'pro.platform_ops': { description: 'technical health and maintenance counters of the professional console (no personal data returned)', aipd: 'in', requiresHds: false, surface: 'pro', aipdRef: 'P14' },
  'calendar.outlook': { description: 'Outlook busy/free of a professional (its own OUTLOOK_ENABLED / CALENDAR_PRODUCTION_APPROVED switches still apply)', aipd: 'in', requiresHds: false, surface: 'appointments', aipdRef: 'P11' },
  // ── outside the AIPD: closed until the AIPD is extended (C-PER)
  'citizen.household': { description: 'household members of the account (C03)', aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.guardians': { description: 'minor ↔ legal guardian link (C05); minors’ independent accounts stay closed', aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.parcours': { description: 'Mon Parcours: the person’s own tracking of démarches and deadlines (C07 C12)', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row; self-tracking, not care or ESSMS follow-up: no (art. 9 may apply)`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.favorites': { description: 'kept records (C10)', aipd: 'out', requiresHds: false, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.history': { description: 'opt-in consultation history (C11)', aipd: 'out', requiresHds: false, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.delegations': { description: 'trusted persons with read-only access', aipd: 'out', requiresHds: false, hdsNote: `${M} row 2 (ordinary account): no`, surface: 'accounts', accountsFull: true, aipdRef: 'C-PER' },
  'citizen.orientation_records': { description: 'the person’s orientations / referral proposals', aipd: 'out', requiresHds: true, hdsNote: `${M} row 10: yes for medical pieces, probable to / from an ESSMS — closed until HDS`, surface: 'accounts', accountsFull: true, aipdRef: 'P8' },
  'citizen.vault': { description: 'Mon Coffre: the person’s encrypted documents (C09)', aipd: 'out', requiresHds: true, hdsNote: `${M} row 8: yes (ANS example of hosting on behalf of the patient)`, surface: 'documents', aipdRef: 'AIPD § 2.1 « coffre »' },
  'citizen.shared_dossier': { description: 'dossiers shared with organisations, their grants, files, passport, downloads and the professional side (consent, attestation, export)', aipd: 'out', requiresHds: true, hdsNote: `${M} row 7: probable once the dossier serves an ESSMS or holds medical pieces — closed until HDS`, surface: 'documents', aipdRef: 'P9' },
  'citizen.saved_diagnostic': { description: 'saving the results of the questionnaire / rights estimate as a dossier', aipd: 'out', requiresHds: false, hdsNote: `${M} row 11: uncertain, leaning no — stays closed (outside the AIPD) until counsel decides`, surface: 'diagnostic', aipdRef: 'AIPD § 2.1 « questionnaire / estimation »' },
  'diagnostic.questionnaire': { description: 'the questionnaire / rights estimate computation itself', aipd: 'out', requiresHds: false, hdsNote: `${M} row 11 / § 5.1: no while health answers are not stored`, surface: 'diagnostic', aipdRef: 'AIPD § 2.1 « questionnaire / estimation »' },
  'pro.case_management': { description: 'ProCase follow-up, notes, history, members (R03–R11)', aipd: 'out', requiresHds: true, hdsDependsOnStructure: true, hdsNote: `${M} row 9: yes / probable for an ESSMS (L312-1); not under L1111-8 for a non-ESSMS — unknown category fails closed`, surface: 'pro', aipdRef: 'P9' },
  'pro.referrals': { description: 'referrals between organisations (R09 R10 E06)', aipd: 'out', requiresHds: true, hdsNote: `${M} row 10: yes / probable — closed until HDS`, surface: 'pro', aipdRef: 'P8' },
  'pro.orientation_selections': { description: 'orientation baskets of an organisation (R18)', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row; selections of public catalogue records: no`, surface: 'pro', aipdRef: 'P8' },
  'pro.siao_interop': { description: 'SI-SIAO interoperability export of a dossier', aipd: 'out', requiresHds: true, hdsNote: `${M} rows 7 and 10 (dossier of an orientation): probable`, surface: 'pro', aipdRef: 'AIPD § 2.1 « SIAO »' },
  'ai.processing': { description: 'assistant, AI recommendations, FALC summaries, AI discovery agents, AI dossier synthesis', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row: no (the AI policy and art. 9 apply separately)`, surface: 'diagnostic', aipdRef: 'AIPD § 2.1 « assistant »' },
  'institution.portal': { description: 'territory / institution space and the creation of institution accounts', aipd: 'out', requiresHds: false, surface: 'institution', aipdRef: 'AIPD § 2.1 « institution »' },
  video: { description: 'video appointments: offering the VIDEO modality, consent, approval, joining (its own VIDEO_* switches still apply)', aipd: 'out', requiresHds: false, hdsNote: `not a matrix row: no (transient stream, no recording)`, surface: 'video', aipdRef: 'AIPD § 2.1 « visio »' },
  // ── never opened by a switch
  'citizen.minor_accounts': { description: 'independent accounts of minors (closed by the age policy; R42-A07)', aipd: 'out', requiresHds: false, surface: 'accounts', openable: false, aipdRef: 'AIPD § 2.2' },
});

/**
 * Route → capabilities (ALL must be open). Longest prefix wins, like the surfaces of public-beta.js. A route of no entry is not gated by this layer (public
 * information, administration, jobs, communications): the surface gate and its own checks still apply. tests/unit/r45-capability-gates.test.js requires
 * every route of the accounts, appointments, pro, documents, diagnostic, institution and video surfaces to be listed here.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ROUTE_CAPABILITIES = Object.freeze({
  // accounts
  auth: ['citizen.account'], 'login-pro-guard': ['citizen.account'],
  'citizen/profile': ['citizen.account'], 'citizen/age-declaration': ['citizen.account'], 'citizen/email-change': ['citizen.account'],
  'citizen/email-change-confirm': ['citizen.account'], 'citizen/phone': ['citizen.account'], 'citizen/preferences': ['citizen.account'],
  'citizen/restriction': ['citizen.account'], 'citizen/espace': ['citizen.account'],
  'citizen/push': ['citizen.push'], 'citizen/household': ['citizen.household'], 'citizen/guardians': ['citizen.guardians'],
  'citizen/parcours': ['citizen.parcours'], 'citizen/favorites': ['citizen.favorites'], 'citizen/history': ['citizen.history'],
  'citizen/delegations': ['citizen.delegations'], 'citizen/referrals': ['citizen.orientation_records'], 'citizen/shares': ['citizen.shared_dossier'],
  // appointments
  rdv: ['citizen.booking'], 'auth/callback/outlook': ['calendar.outlook'],
  'pro/slots': ['pro.agenda'], 'pro/availability': ['pro.agenda'], 'pro/timeoff': ['pro.agenda'], 'pro/rdv': ['pro.agenda'], 'pro/appointments': ['pro.agenda'],
  'pro/outlook': ['calendar.outlook'], 'pro/services': ['pro.agenda'],
  // pro
  'pro/auth': ['pro.account'], 'pro/me': ['pro.account'], 'pro/mfa-setup': ['pro.account'], 'pro/mfa-enrolment': ['pro.account'], 'pro/mfa-invitation': ['pro.account'],
  'pro/notifications': ['pro.account'], 'pro/audit': ['pro.account'],
  'pro/team': ['pro.structure_admin'], 'pro/regional-stats': ['pro.structure_admin'], 'pro/invite': ['pro.structure_admin'], 'pro/resend-invite': ['pro.structure_admin'],
  'pro/structure': ['pro.structure_admin'], 'pro/reports': ['pro.structure_admin'],
  'pro/health-check': ['pro.platform_ops'], 'pro/system-maintenance': ['pro.platform_ops'],
  'pro/cases': ['pro.case_management'], 'pro/referrals': ['pro.referrals'], 'pro/selections': ['pro.orientation_selections'],
  'pro/consent': ['citizen.shared_dossier'], 'pro/attestation-data': ['citizen.shared_dossier'],
  'pro/interop-siao': ['pro.siao_interop', 'citizen.shared_dossier'],
  'pro/dossier-synthesis': ['ai.processing', 'citizen.shared_dossier'],
  'pro/agent-discovery': ['ai.processing'], 'pro/agent-scheduler': ['ai.processing'],
  // documents
  'citizen/coffre': ['citizen.vault'], 'citizen/dossier': ['citizen.shared_dossier'], 'pro/dossier': ['citizen.shared_dossier'],
  share: ['citizen.shared_dossier'], 'share/create': ['citizen.saved_diagnostic', 'citizen.shared_dossier'],
  'public/dossier-revoke': ['citizen.shared_dossier'], 'public/dossier-grants': ['citizen.shared_dossier'], 'public/passport': ['citizen.shared_dossier'],
  download: ['citizen.shared_dossier'],
  // diagnostic / AI
  diagnostic: ['diagnostic.questionnaire'], assistant: ['ai.processing'], 'public/assistant': ['ai.processing'], 'public/falc': ['ai.processing'],
  // institution, video
  institution: ['institution.portal'], 'admin/institutions': ['institution.portal'],
  'pro/appointments/visio': ['video'], 'rdv/appointments/visio': ['video'],
});
const ROUTE_PREFIXES = Object.keys(ROUTE_CAPABILITIES).sort((a, b) => b.length - a.length);

/** the capabilities a route needs (all must be open), [] = not gated by this layer @param {string} path normalized API path @returns {readonly string[]} */
export function capabilitiesOfRoute(path) {
  let p = String(path || '').replace(/\/+$/, '');
  // rdv/appointments/<id>/visio: the citizen side of a video appointment (the id segment is not part of the key)
  if (/^rdv\/appointments\/[^/]+\/visio$/.test(p)) p = 'rdv/appointments/visio';
  const key = ROUTE_PREFIXES.find((x) => p === x || p.startsWith(`${x}/`));
  return key ? ROUTE_CAPABILITIES[key] : [];
}

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();

/** is the capability gate enforced in this environment @param {Record<string, string | undefined>} [envVars] */
export function capabilityEnforced(envVars = process.env) {
  if (isPublicBetaRestricted(envVars)) return true;
  if (['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase())) return true;
  return flag(envVars.ADA_CAPABILITY_ENFORCEMENT) === '1';
}

/** the names listed in ADA_CAPABILITIES_OPEN that are known capabilities @param {Record<string, string | undefined>} [envVars] @returns {Set<string>} */
export function listedCapabilities(envVars = process.env) {
  return new Set(flag(envVars.ADA_CAPABILITIES_OPEN).split(',').map((x) => x.trim().toLowerCase())
    .filter((x) => Object.prototype.hasOwnProperty.call(CAPABILITIES, x)));
}

/**
 * HDS attestation token (ADA_HDS_CERTIFIED_HOSTING), exact format:
 *   HDS1:<provider-slug>:<certificate-reference>:<valid-until YYYY-MM-DD>:<sha256 of the certificate document, 64 lowercase hex>
 * e.g. HDS1:example-host:CERT-2026-0001:2029-12-31:<64 hex>. Anything else — or a date in the past — is invalid and opens nothing.
 */
export const HDS_TOKEN_FORMAT = /^HDS1:([a-z0-9][a-z0-9-]{1,39}):([A-Za-z0-9][A-Za-z0-9._-]{2,63}):(\d{4})-(\d{2})-(\d{2}):([0-9a-f]{64})$/;

/** @param {Record<string, string | undefined>} [envVars] @param {Date} [now] @returns {{ valid: boolean, reason: string | null }} */
export function hdsAttestation(envVars = process.env, now = new Date()) {
  const raw = flag(envVars.ADA_HDS_CERTIFIED_HOSTING);
  if (!raw) return { valid: false, reason: 'HDS_ATTESTATION_ABSENT' };
  const m = HDS_TOKEN_FORMAT.exec(raw);
  if (!m) return { valid: false, reason: 'HDS_ATTESTATION_MALFORMED' };
  const [y, mo, d] = [Number(m[3]), Number(m[4]), Number(m[5])];
  const until = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59));
  if (until.getUTCFullYear() !== y || until.getUTCMonth() !== mo - 1 || until.getUTCDate() !== d) return { valid: false, reason: 'HDS_ATTESTATION_MALFORMED' };
  if (until.getTime() < now.getTime()) return { valid: false, reason: 'HDS_ATTESTATION_EXPIRED' };
  return { valid: true, reason: null };
}

/** is the capability's surface open @param {Capability} cap @param {Record<string, string | undefined>} envVars */
function surfaceOpen(cap, envVars) {
  if (!isPublicBetaRestricted(envVars)) return true;   // outside the beta every surface is served (the capability rule still applies)
  if (!openSurfaces(envVars).has(cap.surface)) return false;
  return !cap.accountsFull || accountsScope(envVars) === 'full';
}

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [envVars]
 * @param {{ now?: Date, structureCategory?: 'ESSMS' | 'HEALTH' | 'NOT_ESSMS' | 'UNKNOWN' }} [opts] structureCategory: from a reviewed classification only (none exists yet)
 * @returns {{ open: boolean, reason: string | null }}
 */
export function capabilityState(name, envVars = process.env, opts = {}) {
  const key = String(name || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CAPABILITIES, key)) return { open: false, reason: 'UNKNOWN_CAPABILITY' };
  if (!capabilityEnforced(envVars)) return { open: true, reason: 'ENFORCEMENT_OFF' };   // development / test LAB only
  const cap = CAPABILITIES[key];
  if (cap.openable === false) return { open: false, reason: 'NOT_OPENABLE' };
  if (!surfaceOpen(cap, envVars)) return { open: false, reason: 'SURFACE_CLOSED' };
  if (cap.aipd !== 'in' && !listedCapabilities(envVars).has(key)) return { open: false, reason: 'NOT_LISTED_IN_ADA_CAPABILITIES_OPEN' };
  // a structure-dependent HDS need (ESSMS or not) is waived only for a structure positively classified NOT_ESSMS; unknown = HDS needed (fail-closed)
  const hdsNeeded = cap.requiresHds && !(cap.hdsDependsOnStructure && opts.structureCategory === 'NOT_ESSMS');
  if (hdsNeeded && !hdsAttestation(envVars, opts.now).valid) return { open: false, reason: 'HDS_HOSTING_NOT_ATTESTED' };
  return { open: true, reason: null };
}

/** @param {string} name @param {Record<string, string | undefined>} [envVars] */
export function capabilityOpen(name, envVars = process.env) {
  return capabilityState(name, envVars).open;
}

/** every capability with its state, for the release gate and the readiness doctor (never a value) @param {Record<string, string | undefined>} [envVars] */
export function capabilityStates(envVars = process.env) {
  return Object.entries(CAPABILITIES).map(([name, cap]) => ({ name, aipd: cap.aipd, requiresHds: cap.requiresHds, ...capabilityState(name, envVars) }));
}

/** the first closed capability of a route, or null @param {string} path @param {Record<string, string | undefined>} [envVars] */
export function closedCapabilityOfRoute(path, envVars = process.env) {
  return capabilitiesOfRoute(path).find((c) => !capabilityOpen(c, envVars)) || null;
}

/** the refusal body (no data) @param {string} capability */
export function capabilityRefusal(capability) {
  return { error: CAPABILITY_NOT_OPEN, code: CAPABILITY_NOT_OPEN, capability, message: CAPABILITY_NOT_OPEN_MESSAGE };
}

/** write the refusal @param {any} res @param {string} capability */
export function sendCapabilityRefusal(res, capability) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json(capabilityRefusal(capability));
}

/**
 * Handler-level guard: answers 503 CAPABILITY_NOT_OPEN (no data) and returns false when one of the capabilities is closed.
 * @param {any} res @param {string | readonly string[]} names @param {Record<string, string | undefined>} [envVars] @returns {boolean} true = may continue
 */
export function requireCapability(res, names, envVars = process.env) {
  const closed = (Array.isArray(names) ? names : [names]).find((n) => !capabilityOpen(n, envVars));
  if (!closed) return true;
  sendCapabilityRefusal(res, closed);
  return false;
}

/**
 * Handler-level wrapper: the capability is checked BEFORE the handler and its authentication wrapper run (no session lookup, no database access).
 * @param {string | readonly string[]} names @param {(req: any, res: any) => any} handler @returns {(req: any, res: any) => any}
 */
export function withCapability(names, handler) {
  return async function capabilityGuarded(/** @type {any} */ req, /** @type {any} */ res) {
    if (!requireCapability(res, names)) return undefined;
    return handler(req, res);
  };
}

/** normalized API path of a request, as api/index.js computes it @param {any} req */
function requestPath(req) {
  let p = '';
  try { p = new URL(String(req?.url || '/'), 'http://localhost').pathname; } catch { p = ''; }
  return p.replace(/^\/api(\/|$)/, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Central dispatch hook (used by api/routes.js, so by api/index.js and dev-server.js, without touching the byte-pinned api/index.js): wraps a route so its
 * handler is refused before it runs — whatever the role, the beta flag or the method — when a capability of the route is closed. The module is loaded (the
 * router needs its default export) but none of its code handles the request.
 * @template {{ path: string, match: string, handler: Function }} R @param {R} route @returns {R}
 */
export function gateRoute(route) {
  const load = route.handler;
  return /** @type {R} */ ({
    ...route,
    handler: async () => {
      const mod = await load();
      const inner = mod?.default || mod;
      if (typeof inner !== 'function') return mod;
      /** @param {any} req @param {any} res */
      const gated = async (req, res) => {
        const p = requestPath(req);
        const key = p === route.path.replace(/\/$/, '') || p.startsWith(route.path.endsWith('/') ? route.path : `${route.path}/`) ? p : route.path;
        const closed = closedCapabilityOfRoute(key);
        if (closed) return sendCapabilityRefusal(res, closed);
        return inner(req, res);
      };
      return { ...mod, default: gated };
    },
  });
}
