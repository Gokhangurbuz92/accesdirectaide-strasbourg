// @ts-check
/**
 * G14 release 3 — the ONE taxonomy of needs (20 domains × 86 subdomains, data/reference/social-domains.v1.json) for the interface: the picker of the
 * ADA Pro service editor and of the own-booking-page form, the directory's need filter, the « prendre rendez-vous » links of /situation and /droits.
 * Labels come from the « reference » namespace (reference:domain.<id>, reference:sub.<id>) with the French label of the file as default.
 */
import reference from '../../data/reference/social-domains.v1.json';

/** @typedef {{ id: string, fr: string }} NeedItem @typedef {{ id: string, fr: string, subdomains: NeedItem[] }} NeedDomain */
/** @type {NeedDomain[]} */
export const NEED_DOMAINS = /** @type {any} */ (reference).domains.map((/** @type {any} */ d) => ({
  id: String(d.id), fr: String(d.fr), subdomains: d.subdomains.map((/** @type {any} */ s) => ({ id: String(s.id), fr: String(s.fr) })),
}));
/** @type {Map<string, { id: string, fr: string, domain: string }>} */
export const NEED_BY_ID = new Map(NEED_DOMAINS.flatMap((d) => d.subdomains.map((s) => [s.id, { ...s, domain: d.id }])));
export const DOMAIN_IDS = new Set(NEED_DOMAINS.map((d) => d.id));
/** the server's limit (api/lib/service-needs.js MAX_SERVICE_SUBDOMAINS) */
export const MAX_NEEDS = 8;

/** @param {(k: string, d: string) => string} t @param {string} id */
export const needName = (t, id) => t(`reference:sub.${id}`, NEED_BY_ID.get(id)?.fr || id);
/** @param {(k: string, d: string) => string} t @param {string} id */
export const domainName = (t, id) => t(`reference:domain.${id}`, NEED_DOMAINS.find((d) => d.id === id)?.fr || id);

/** a directory link to the places that take appointments for this need (AccesDirectAide booking, or a reviewed own booking page) @param {string} id */
export const needBookingHref = (id) => `/structures?${new URLSearchParams({ subdomain: id })}`;
