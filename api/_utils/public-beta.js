/**
 * Restricted public beta (owner directive 29/10/2026): with ADA_PUBLIC_BETA_RESTRICTED=1 the API serves ONLY the public, read-only information routes.
 * Accounts (citizen, professional, institution, administration), appointments, case files, uploads, sharing, messaging, contact forms, the assistant and
 * every cron are refused server-side, so no personal data can be collected while the legal, hosting and operational acceptance is pending.
 * This is an allowlist: a route that is not listed here is refused.
 */
import { isCspReportRequest } from './csp-reporting.js';

const EXACT = new Set([
  'health', 'health/live', 'health/ready', 'healthz', 'status',
  'robots.txt', 'robots', 'sitemap.xml', 'sitemap',
  'public/page', 'taxonomy', 'search', 'search-pro', 'glossaire',
  // read by the shell on every page: answers « not signed in » and creates nothing
  'auth/me',
]);
// R32: « translations » serves the checked translations of the same public records (read-only, same D-5 rule)
// R36: « pdf/aides », « pdf/demarches » = the PDF of a published aide or démarche (api/_handlers/pdf.js: GET only, D-5 visible records only, writes nothing,
// rate-limited) — the same public information as its page; every other « pdf » or document path stays closed (documents surface)
const PREFIX = ['aides', 'aids', 'structures', 'demarches', 'actualites', 'guides', 'tools', 'dispositifs', 'ressources', 'translations', 'pdf/aides', 'pdf/demarches'];
const READ_METHODS = new Set(['GET', 'HEAD']);
// the two citizen searches take their query in a POST body; they read and write nothing (no account, no history)
const READ_ONLY_POST = new Set(['search', 'search-pro']);

export const PUBLIC_BETA_MESSAGE =
  'Bêta publique : cette fonction n’est pas encore ouverte. Pendant la bêta, Accès Direct Aide permet seulement de consulter les aides, les démarches '
  + 'et les structures vérifiées ; aucun compte, rendez-vous ni document ne peut être créé.';

/** R43-MAIL: the provider's delivery-event webhook, when switched on @param {string} method @param {string} path @param {Record<string, string | undefined>} [envVars] */
export function isMailEventsRequest(method, path, envVars = process.env) {
  return String(method || '').toUpperCase() === 'POST' && path === 'monitor/mail-events/mailjet'
    && ['1', 'true'].includes(String(envVars.MAILER_EVENTS_ENABLED || '').trim().toLowerCase());
}

/** @param {Record<string, string | undefined>} [envVars] */
export function isPublicBetaRestricted(envVars = process.env) {
  return ['1', 'true'].includes(String(envVars.ADA_PUBLIC_BETA_RESTRICTED || '').trim().toLowerCase());
}

/**
 * R35 (owner decision 02/11/2026, « connect and activate what is built, one capability at a time »): ADA_BETA_OPEN_SURFACES opens named surfaces while
 * the beta stays on for everything else, e.g. ADA_BETA_OPEN_SURFACES=appointments,communications. Fail-closed: unset = nothing opened, an unknown name
 * opens nothing, there is no wildcard (lifting the whole beta stays a separate, deliberate change of ADA_PUBLIC_BETA_RESTRICTED). An opened surface only
 * passes this gate: authentication, MFA, roles, organisation isolation, CSRF, consent and every per-feature approval (VIDEO_PRODUCTION_APPROVED,
 * GDPR_PURGE_ENABLED…) still apply to its routes. A route belongs to ONE surface (longest prefix wins); a route of no surface stays closed.
 */
export const SURFACES = {
  accounts: ['auth', 'citizen', 'login-pro-guard'],
  pro: ['pro'],
  institution: ['institution'],
  appointments: ['rdv', 'pro/slots', 'pro/availability', 'pro/timeoff', 'pro/rdv', 'pro/appointments', 'pro/outlook', 'auth/callback/outlook'],
  video: ['pro/appointments/visio'],
  communications: ['messages', 'secure-messages', 'contact', 'support', 'feedback', 'reports', 'public/suggest-structure', 'public/sms-notify', 'assistant/feedback', 'pro/messages', 'pro/notifications'],
  documents: ['citizen/coffre', 'citizen/dossier', 'pro/dossier', 'share', 'public/dossier-revoke', 'public/dossier-grants', 'public/passport', 'download', 'pdf'],
  diagnostic: ['diagnostic', 'drees', 'assistant', 'public/falc', 'public/assistant', 'tts'],
  admin: ['admin'],
  // R40 / G2: « jobs » classifies the cron and monitor routes but can NOT be opened as a whole (NOT_OPENABLE below): it used to open every cron and monitor
  // route at once — the legacy importers and hive-scan (a cloud AI provider that is not approved) included. Jobs open one at a time (ADA_BETA_OPEN_JOBS).
  jobs: ['cron', 'monitor'],
};
/** surfaces that ADA_BETA_OPEN_SURFACES never opens (R40 / G2) */
export const NOT_OPENABLE = Object.freeze(['jobs']);
const SURFACE_PREFIXES = Object.entries(SURFACES).flatMap(([name, list]) => list.map((prefix) => ({ name, prefix }))).sort((a, b) => b.prefix.length - a.prefix.length);

/** the surface a route belongs to, or null @param {string} path */
export function surfaceOf(path) {
  const p = String(path || '');
  return SURFACE_PREFIXES.find((x) => p === x.prefix || p.startsWith(`${x.prefix}/`))?.name || null;
}

/** the surfaces opened during the beta @param {Record<string, string | undefined>} [envVars] @returns {Set<string>} */
export function openSurfaces(envVars = process.env) {
  return new Set(String(envVars.ADA_BETA_OPEN_SURFACES || '').split(',').map((x) => x.trim().toLowerCase())
    .filter((x) => Object.prototype.hasOwnProperty.call(SURFACES, x) && !NOT_OPENABLE.includes(x)));
}

/**
 * R38 — scheduled jobs one at a time. ADA_BETA_OPEN_JOBS opens only the named jobs (e.g. ADA_BETA_OPEN_JOBS=actualites,health-alert); since R40 (G2) this
 * is the ONLY way to open a job during the beta (the « jobs » surface is not openable, and the monitor routes stay closed). Fail-closed, like the surfaces: unset = none, an unknown name opens
 * nothing, no wildcard. Each job's own CRON_SECRET check and switches (GDPR_PURGE_ENABLED, INGESTION_DRY_RUN…) still apply.
 *   category A  public-data or read-only maintenance — opened by ADA_BETA_OPEN_JOBS alone
 *   category B  needs a provider or more engineering   — opened by ADA_BETA_OPEN_JOBS alone (the job reports what it could not deliver)
 *   category C  personal data: reminders, deadlines, deletion — ALSO needs the owner's recorded approval of that job in ADA_JOBS_APPROVED (legal basis,
 *               retention, working mail provider): opening it is an operational switch, approving it is a separate, deliberate one
 *   category D  legacy, superseded by the automatic veille — can never be opened one at a time (and has no schedule in vercel.json since R38)
 */
/** @type {Readonly<Record<string, 'A' | 'B' | 'C' | 'D'>>} */
export const SCHEDULED_JOBS = Object.freeze({
  // R40 / G1: the automatic verification (D-5 v2, api/_services/verification/chain.js) — the only path that re-verifies, corrects and withdraws published
  // records. Public official sources only, no personal data: category A. Known (so it CAN be opened alone later), closed by default, no schedule yet.
  veille: 'A',
  actualites: 'A', 'health-alert': 'B', 'ingest-structures': 'B', 'ingest-aids': 'B',   // ingest-aids: the only Aides-territoires path (needs its token)
  'parcours-reminder': 'C', 'referral-timeouts': 'C', 'rdv-reminder': 'C', 'gdpr-purge': 'C',
  'ingest-demarches': 'D', 'ingest-annuaire': 'D', 'review-queue/scan': 'D',
});
/** @param {unknown} v */
const listOf = (v) => new Set(String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));

/** the jobs this environment opens during the beta @param {Record<string, string | undefined>} [envVars] @returns {Set<string>} */
export function openJobs(envVars = process.env) {
  const named = listOf(envVars.ADA_BETA_OPEN_JOBS); const approved = listOf(envVars.ADA_JOBS_APPROVED);
  return new Set([...named].filter((j) => Object.prototype.hasOwnProperty.call(SCHEDULED_JOBS, j)
    && (SCHEDULED_JOBS[j] === 'A' || SCHEDULED_JOBS[j] === 'B' || (SCHEDULED_JOBS[j] === 'C' && approved.has(j)))));
}

/** the state of every scheduled job in this environment (no secret is read, only whether the switches name the job) @param {Record<string, string | undefined>} [envVars] */
export function jobStates(envVars = process.env) {
  const restricted = isPublicBetaRestricted(envVars); const open = openJobs(envVars);   // R40 / G2: no « all jobs » switch inside the beta any more
  const named = listOf(envVars.ADA_BETA_OPEN_JOBS); const approved = listOf(envVars.ADA_JOBS_APPROVED);
  return Object.entries(SCHEDULED_JOBS).map(([job, category]) => ({ job, category,
    state: !restricted ? 'OPEN_ALL_JOBS' : open.has(job) ? 'OPEN' : category === 'D' ? 'LEGACY_CLOSED' : category === 'C' && named.has(job) && !approved.has(job) ? 'AWAITING_APPROVAL' : 'CLOSED',
    approved: category !== 'C' || approved.has(job) }));
}

/** is this cron path one of the jobs opened one at a time @param {string} path normalized API path (« cron/actualites ») */
export function isOpenJobPath(path, envVars = process.env) {
  const p = String(path || '');
  return p.startsWith('cron/') && openJobs(envVars).has(p.slice('cron/'.length));
}

/**
 * @param {string} method
 * @param {string} path normalized API path without the « /api/ » prefix and without leading or trailing slashes
 * @param {Record<string, string | undefined>} [envVars]
 */
export function isAllowedInPublicBeta(method, path, envVars = process.env) {
  const p = String(path || '');
  if (String(method || '').toUpperCase() === 'POST' && READ_ONLY_POST.has(p)) return true;
  // R42 (F8): browser CSP violation reports — POST to that exact path only, when staged reporting is on (LAB by default; Production only with
  // ADA_CSP_REPORTS=log). The handler stores nothing and logs a minimised summary; no other monitor route and no job is opened by this.
  if (isCspReportRequest(method, p, envVars)) return true;
  // R43-MAIL: the Mailjet delivery events — POST to that exact path only, and only when MAILER_EVENTS_ENABLED=1 (basic auth is checked by the handler)
  if (isMailEventsRequest(method, p, envVars)) return true;
  const surface = surfaceOf(p);
  if (surface && openSurfaces(envVars).has(surface)) return true;
  if (isOpenJobPath(p, envVars) && ['GET', 'POST'].includes(String(method || '').toUpperCase())) return true;   // R38: one job at a time
  if (!READ_METHODS.has(String(method || '').toUpperCase())) return false;
  if (EXACT.has(p)) return true;
  return PREFIX.some((x) => p === x || p.startsWith(`${x}/`));
}
