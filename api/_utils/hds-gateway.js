// @ts-check
/**
 * G14-R3 (owner 24/11/2026: HDS for Mon Coffre and shared dossiers) — the fail-closed switch between the main application (Vercel + Neon, NOT HDS) and
 * the HDS service (services/hds, Scalingo osc-fr1 with the HDS option). Architecture: CONTROL/master/G14_HDS_MIGRATION_PLAN.md (option 1).
 *
 * In a deployed environment (VERCEL_ENV production / preview) a capability served by the HDS service (HDS_SERVICE_CAPABILITIES) opens ONLY when, on top
 * of the existing rules of api/_utils/capabilities.js (AIPD listing, surface, HDS attestation token):
 *   1. HDS_PRODUCTION_APPROVED=true            the owner's recorded approval (contract + HDS appendix, contact person, AIPD addendum, consent texts)
 *   2. HDS_SERVICE_URL                         an https ORIGIN whose host is on HDS_CERTIFIED_HOSTS below (code-reviewed allow-list, not an env value)
 *   3. HDS_TICKET_PRIVATE_KEY + HDS_TICKET_KID  a valid P-256 signing key (api/lib/hds-ticket.js)
 *   4. the attestation token's provider (ADA_HDS_CERTIFIED_HOSTING) is the provider of that allow-list entry
 *   5. the module is PORTED to the HDS service (HDS_MODULES below — a code change, never a switch)
 * And whatever the switches say, the Vercel routes of these capabilities never serve their data there (hdsServiceRoute → 409 HDS_SERVICE_REQUIRED, no
 * handler run, no database read): the browser talks to the HDS service with a ticket from citizen/hds-ticket. In the LAB (not deployed) the legacy
 * Vercel-side code keeps running so the existing journeys and tests stay meaningful; the gateway is then optional (loopback http allowed).
 *
 * This module imports nothing from capabilities.js (no cycle).
 */
import { parseTicketPrivateKey, TICKET_KID_FORMAT } from '../lib/hds-ticket.js';

/** capabilities whose data live in the HDS service, never on Vercel / Neon in a deployed environment */
export const HDS_SERVICE_CAPABILITIES = Object.freeze(['citizen.vault', 'citizen.shared_dossier']);

/**
 * Port status per capability — changed only by a reviewed code change. « ported »: every route the browser needs exists in services/hds and the
 * frontend calls it. citizen.shared_dossier: the data plane exists (dossier, grants, files, access log, erasure) but share/create (rights estimate),
 * the passport, invitations, threads, secure messages, the professional views / export / attestation / SIAO hand-over and Parcours import still run
 * on Vercel only — so it stays closed.
 * @type {Readonly<Record<string, 'ported' | 'partial'>>}
 */
export const HDS_MODULES = Object.freeze({ 'citizen.vault': 'ported', 'citizen.shared_dossier': 'partial' });

/**
 * Certified hosts (allow-list). Source: Scalingo HDS certificate n° 38436 (BYCYB, HDS 2.0, activities 1–6, valid until 11/09/2028), read 24/11/2026 on
 * https://doc.scalingo.com/compliance/hds ; default app domains per region on https://doc.scalingo.com/platform/internals/regions ; HDS available on two
 * regions per Scalingo's written reply of 23/11/2026 (CONTROL/master/G14_HDS_PLAN_OZET_TR.md). A custom domain is NOT accepted until added here.
 */
export const HDS_CERTIFIED_HOSTS = Object.freeze([
  Object.freeze({ provider: 'scalingo', suffix: '.osc-fr1.scalingo.io', region: 'osc-fr1' }),
  Object.freeze({ provider: 'scalingo', suffix: '.osc-secnum-fr1.scalingo.io', region: 'osc-secnum-fr1' }),
]);
/** the app created by the owner (osc-fr1, HDS badge, 24/11/2026) */
export const HDS_DEFAULT_ORIGIN = 'https://ada-hds-strasbourg.osc-fr1.scalingo.io';

export const HDS_SERVICE_REQUIRED = 'HDS_SERVICE_REQUIRED';
export const HDS_SERVICE_REQUIRED_MESSAGE = 'Ces documents sont conservés chez un hébergeur certifié pour les données de santé : ce service ne les lit ni ne les enregistre.';

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** @param {Record<string, string | undefined>} env */
export const isDeployed = (env) => ['production', 'preview'].includes(flag(env.VERCEL_ENV).toLowerCase());

/** the allow-list entry of a host, or null @param {string} hostname */
export function certifiedHostOf(hostname) {
  const h = String(hostname || '').toLowerCase();
  return HDS_CERTIFIED_HOSTS.find((e) => h.endsWith(e.suffix) && h.length > e.suffix.length && /^[a-z0-9-]+$/.test(h.slice(0, -e.suffix.length))) || null;
}

/** @param {string} key */
export const hdsModuleReady = (key) => HDS_MODULES[key] === 'ported';

/**
 * State of the gateway (no I/O, never a value).
 * @param {Record<string, string | undefined>} [env] @param {{ deployed?: boolean }} [o]
 * @returns {{ ready: boolean, reason: string | null, origin: string | null, provider: string | null, certified: boolean }}
 */
export function hdsGatewayState(env = process.env, o = {}) {
  const deployed = o.deployed ?? isDeployed(env);
  const no = (/** @type {string} */ reason, origin = /** @type {string | null} */ (null)) => ({ ready: false, reason, origin, provider: null, certified: false });
  const raw = flag(env.HDS_SERVICE_URL);
  if (!raw) return no('HDS_SERVICE_URL_ABSENT');
  let u;
  try { u = new URL(raw); } catch { return no('HDS_SERVICE_URL_INVALID'); }
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return no('HDS_SERVICE_URL_NOT_AN_ORIGIN');
  const origin = u.origin;
  const entry = certifiedHostOf(u.hostname);
  if (deployed) {
    if (u.protocol !== 'https:') return no('HDS_SERVICE_URL_NOT_HTTPS', origin);
    if (!entry) return no('HDS_HOST_NOT_ON_CERTIFIED_ALLOWLIST', origin);
    if (flag(env.HDS_PRODUCTION_APPROVED) !== 'true') return no('HDS_PRODUCTION_NOT_APPROVED', origin);
  } else if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname)))) return no('HDS_SERVICE_URL_NOT_HTTPS', origin);
  if (!TICKET_KID_FORMAT.test(flag(env.HDS_TICKET_KID))) return no('HDS_TICKET_KID_INVALID', origin);
  if (!parseTicketPrivateKey(env.HDS_TICKET_PRIVATE_KEY)) return no('HDS_TICKET_KEY_INVALID', origin);
  return { ready: true, reason: null, origin, provider: entry ? entry.provider : null, certified: Boolean(entry) };
}

/** is this set of route capabilities served by the HDS service only (deployed environment) @param {readonly string[]} caps @param {Record<string, string | undefined>} [env] */
export function hdsServiceRoute(caps, env = process.env) {
  return isDeployed(env) && caps.some((c) => HDS_SERVICE_CAPABILITIES.includes(c));
}

/** the refusal body (no data) @param {Record<string, string | undefined>} [env] */
export function hdsServiceRefusal(env = process.env) {
  const g = hdsGatewayState(env);
  return { error: HDS_SERVICE_REQUIRED, code: HDS_SERVICE_REQUIRED, message: HDS_SERVICE_REQUIRED_MESSAGE, ...(g.ready ? { hdsOrigin: g.origin } : {}) };
}

/** @param {any} res @param {Record<string, string | undefined>} [env] */
export function sendHdsServiceRefusal(res, env = process.env) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(409).json(hdsServiceRefusal(env));
}
