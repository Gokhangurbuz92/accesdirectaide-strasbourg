// @ts-check
/**
 * G14 release 3 (owner approval 24/11/2026) — « appointments on our own system »: a place that takes appointments on its own booking page (not through
 * AccesDirectAide). Pure rules: URL validation, recognised public booking platforms, the public switch. Storage and review: api/_services/external-booking.js.
 *
 *   ADA_EXTERNAL_BOOKING   unset / anything else  closed: no badge, no link, nothing of it in a public answer (the professional and administrator screens
 *                                                 still record and review, so the switch can be opened on reviewed data);
 *                          « open »               an APPROVED page is shown (StructureDetail block, Annuaire badge « Rendez-vous sur leur site »);
 *                          « platforms »          only an APPROVED page on a RECOGNISED public platform (PLATFORMS below) is shown.
 *   The badge is NOT AccesDirectAide online booking: it never counts in `online_booking` (api/lib/bookable-structures.js) nor in the « Rendez-vous en
 *   ligne » filter.
 *
 * URL rules (validateExternalBookingUrl): https only; a public DNS name (no IP literal, no port, no local / test suffix); no user name or password; no
 * e-mail address, token or person's field (name, phone, address…) in the query; at most MAX_URL_LENGTH characters. On a recognised platform the
 * search-context parameters that can describe a PERSON (address, coordinates, BAN street id, INSEE code of the person's address) are removed: the link
 * names the place, never the visitor. The outbound link adds nothing about the visitor (rel="noopener noreferrer", referrerPolicy no-referrer).
 *
 * Recognised platforms (research CONTROL/master/completion/R3_RDV_EXTERNES_FR.md, open-source code betagouv/rdv-service-public, read 24/11/2026): one
 * code base of the ANCT serves RDV Solidarités, RDV Aide Numérique, RDV Service Public and its State instance, each on its own host. Their public,
 * account-free deep links to a place's booking are /org/<public_link_id>(/<slug>), /org/ext/<département>/<external id>(/<slug>), /motif/<id>(/<slug>)
 * and /prendre_rdv(?…) / /prendre_rdv_prescripteur(?…). A page of another host is accepted as « other » (the place's own site) after the same review.
 */

export const EXTERNAL_BOOKING_SWITCH = 'ADA_EXTERNAL_BOOKING';
export const MAX_URL_LENGTH = 2048;

/** @param {Record<string, string | undefined>} [env] @returns {'open' | 'platforms' | 'closed'} */
export function externalBookingMode(env = process.env) {
  const v = String(env[EXTERNAL_BOOKING_SWITCH] ?? '').trim().toLowerCase();
  return v === 'open' ? 'open' : v === 'platforms' ? 'platforms' : 'closed';
}

/** @typedef {{ id: string, label: string, operator: string, hosts: readonly string[] }} Platform */
/** @type {readonly Platform[]} */
export const PLATFORMS = Object.freeze([
  { id: 'rdv-solidarites', label: 'RDV Solidarités', operator: 'ANCT', hosts: Object.freeze(['www.rdv-solidarites.fr', 'rdv-solidarites.fr']) },
  { id: 'rdv-aide-numerique', label: 'RDV Aide Numérique', operator: 'ANCT', hosts: Object.freeze(['www.rdv-aide-numerique.fr', 'rdv-aide-numerique.fr']) },
  { id: 'rdv-service-public', label: 'RDV Service Public', operator: 'ANCT', hosts: Object.freeze(['rdv.anct.gouv.fr']) },
  { id: 'rdv-service-public-etat', label: 'RDV Service Public (État)', operator: 'DINUM', hosts: Object.freeze(['rdv.numerique.gouv.fr']) },
]);
export const PLATFORM_IDS = Object.freeze(['other', ...PLATFORMS.map((p) => p.id)]);
const PLATFORM_BY_HOST = new Map(PLATFORMS.flatMap((p) => p.hosts.map((h) => [h, p])));

/** the public deep-link paths of the ANCT booking code base (routes.rb: /org, /org/ext, /motif, /prendre_rdv, /prendre_rdv_prescripteur) */
const PLATFORM_PATHS = [
  /^\/org\/[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{0,120})?\/?$/,
  /^\/org\/ext\/[0-9AB]{2,3}\/[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{0,120})?\/?$/,
  /^\/motif\/[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{0,120})?\/?$/,
  /^\/prendre_rdv(_prescripteur)?\/?$/,
];
/** search-context parameters of those platforms that can describe the VISITOR (their address, position): always removed from a stored link */
const PLATFORM_PERSON_PARAMS = ['address', 'latitude', 'longitude', 'city_code', 'street_ban_id', 'user_id', 'invitation_token', 'referent_ids[]', 'referent_ids'];
/** query keys that never belong in a place's public booking link (a person's data or a credential), on any host */
const FORBIDDEN_KEYS = /^(e?-?mail|courriel|tel|telephone|phone|mobile|nom|prenom|first_?name|last_?name|name_user|birth.*|date_?naissance|password|pass|pwd|token|access_?token|auth.*|session.*|sid|jwt|api_?key|key|secret|code|otp|nir|secu|address|adresse|latitude|longitude|invitation_token)$/i;

/**
 * @param {unknown} raw
 * @returns {{ ok: true, url: string, platform: string, host: string } | { ok: false, code: 'URL_REQUIRED' | 'URL_TOO_LONG' | 'URL_INVALID' | 'HTTPS_REQUIRED' | 'CREDENTIALS_IN_URL' | 'HOST_NOT_PUBLIC' | 'PERSONAL_DATA_IN_URL' }}
 */
export function validateExternalBookingUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, code: 'URL_REQUIRED' };
  if (s.length > MAX_URL_LENGTH) return { ok: false, code: 'URL_TOO_LONG' };
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return { ok: false, code: 'URL_INVALID' };
  /** @type {URL} */ let u;
  try { u = new URL(s); } catch { return { ok: false, code: 'URL_INVALID' }; }
  if (u.protocol !== 'https:') return { ok: false, code: 'HTTPS_REQUIRED' };
  if (u.username || u.password || /^https:\/\/[^/?#]*@/i.test(s)) return { ok: false, code: 'CREDENTIALS_IN_URL' };
  const host = u.hostname.toLowerCase();
  if (u.port || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || /^[0-9.]+$/.test(host) || host.startsWith('.') || host.endsWith('.')
    || /(^|\.)(localhost|local|test|example|invalid|internal|lan|home|corp|onion)$/.test(host)) return { ok: false, code: 'HOST_NOT_PUBLIC' };
  // an e-mail address anywhere after the host, or a key that carries a person's data or a credential
  if (/@|%40/i.test(`${u.pathname}${u.search}${u.hash}`)) return { ok: false, code: 'PERSONAL_DATA_IN_URL' };
  const platform = PLATFORM_BY_HOST.get(host);
  if (platform) for (const k of PLATFORM_PERSON_PARAMS) u.searchParams.delete(k);
  for (const k of u.searchParams.keys()) if (FORBIDDEN_KEYS.test(k)) return { ok: false, code: 'PERSONAL_DATA_IN_URL' };
  const recognised = Boolean(platform) && PLATFORM_PATHS.some((re) => re.test(u.pathname));
  const url = u.toString();
  if (url.length > MAX_URL_LENGTH) return { ok: false, code: 'URL_TOO_LONG' };
  return { ok: true, url, platform: recognised && platform ? platform.id : 'other', host };
}

/** @param {string} id @returns {Platform | null} */
export function platformOf(id) {
  return PLATFORMS.find((p) => p.id === id) || null;
}

/**
 * The public shape of a stored record, or null when it must not be shown (not approved, switch closed, « platforms » mode and not on a recognised
 * platform, or a URL that no longer passes the rules). Never the reviewer, the note, the source or the submitter.
 * @param {{ url?: unknown, platform?: unknown, status?: unknown, subdomains?: unknown } | null | undefined} record @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string, platform: string, platformLabel: string | null, host: string, subdomains: string[] } | null}
 */
export function publicExternalBooking(record, env = process.env) {
  const mode = externalBookingMode(env);
  if (mode === 'closed' || !record || record.status !== 'APPROVED') return null;
  const v = validateExternalBookingUrl(record.url);
  if (!v.ok) return null;
  const platform = typeof record.platform === 'string' && PLATFORM_IDS.includes(record.platform) && record.platform === v.platform ? record.platform : v.platform;
  if (mode === 'platforms' && platform === 'other') return null;
  return { url: v.url, platform, platformLabel: platformOf(platform)?.label || null, host: v.host,
    subdomains: Array.isArray(record.subdomains) ? record.subdomains.filter((x) => typeof x === 'string') : [] };
}
